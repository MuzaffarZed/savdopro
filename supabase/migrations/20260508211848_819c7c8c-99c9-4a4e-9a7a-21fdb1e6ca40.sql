-- 1) Customer credit limit
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS credit_limit numeric NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.customers.credit_limit IS '0 = limitsiz; >0 = mijoz qarzining maksimal ruxsat etilgan summasi';

-- 2) Replace process_sale to support split (cash + click) payment in one sale, and credit-limit enforcement.
CREATE OR REPLACE FUNCTION public.process_sale(
  _branch_id uuid,
  _warehouse_id uuid,
  _customer_id uuid,
  _items jsonb,
  _amount_paid numeric,
  _payment_method payment_method,
  _user_id uuid,
  _idempotency_key text,
  _cash_paid numeric DEFAULT NULL,
  _click_paid numeric DEFAULT NULL
)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_existing uuid;
  v_sale_id uuid;
  v_item jsonb;
  v_product_id uuid;
  v_quantity numeric;
  v_sell_price numeric;
  v_required numeric;
  v_used numeric;
  v_item_cost numeric;
  v_item_total numeric;
  v_total_sale numeric := 0;
  v_total_cost numeric := 0;
  v_remaining_debt numeric;
  v_sale_item_id uuid;
  v_batch record;
  v_shift_id uuid;
  v_is_split boolean;
  v_cash numeric;
  v_click numeric;
  v_total_paid numeric;
  v_method payment_method;
  v_credit_limit numeric;
  v_cur_balance numeric;
  v_projected_balance numeric;
BEGIN
  IF auth.uid() IS NULL OR auth.uid() <> _user_id THEN
    RAISE EXCEPTION 'Ruxsat yo''q';
  END IF;

  IF _idempotency_key IS NOT NULL THEN
    SELECT result_id INTO v_existing FROM public.idempotency_keys WHERE key = _idempotency_key;
    IF FOUND THEN RETURN v_existing; END IF;
  END IF;

  IF jsonb_array_length(_items) = 0 THEN RAISE EXCEPTION 'No items in sale'; END IF;

  -- Determine split vs single payment mode
  v_is_split := (_cash_paid IS NOT NULL OR _click_paid IS NOT NULL);
  IF v_is_split THEN
    v_cash := COALESCE(_cash_paid, 0);
    v_click := COALESCE(_click_paid, 0);
    IF v_cash < 0 OR v_click < 0 THEN RAISE EXCEPTION 'To''lov summasi manfiy bo''lmaydi'; END IF;
    v_total_paid := v_cash + v_click;
    -- Sale's payment_method stores the dominant non-zero method; both rows will live in payments
    IF v_cash > 0 AND v_click > 0 THEN
      v_method := 'cash'; -- mixed; payments table holds the breakdown
    ELSIF v_click > 0 THEN
      v_method := 'click';
    ELSE
      v_method := 'cash';
    END IF;
  ELSE
    IF _amount_paid < 0 THEN RAISE EXCEPTION 'Amount paid cannot be negative'; END IF;
    v_total_paid := _amount_paid;
    v_method := _payment_method;
    v_cash := CASE WHEN _payment_method = 'cash' THEN _amount_paid ELSE 0 END;
    v_click := CASE WHEN _payment_method = 'click' THEN _amount_paid ELSE 0 END;
  END IF;

  SELECT id INTO v_shift_id
  FROM public.shifts
  WHERE warehouse_id = _warehouse_id
    AND branch_id = _branch_id
    AND status = 'open'
  ORDER BY opened_at DESC
  LIMIT 1;

  IF v_shift_id IS NULL THEN
    RAISE EXCEPTION 'Bu sklad uchun ochiq smena yo''q';
  END IF;

  INSERT INTO public.sales (branch_id, warehouse_id, customer_id, amount_paid, payment_method, created_by, shift_id)
  VALUES (_branch_id, _warehouse_id, _customer_id, v_total_paid, v_method, _user_id, v_shift_id)
  RETURNING id INTO v_sale_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(_items)
  LOOP
    v_product_id := (v_item->>'product_id')::uuid;
    v_quantity := (v_item->>'quantity')::numeric;
    v_sell_price := (v_item->>'sell_price')::numeric;

    IF v_quantity <= 0 THEN RAISE EXCEPTION 'Item quantity must be > 0'; END IF;
    IF v_sell_price < 0 THEN RAISE EXCEPTION 'Sell price cannot be negative'; END IF;

    v_item_total := v_quantity * v_sell_price;
    v_item_cost := 0;
    v_required := v_quantity;

    INSERT INTO public.sale_items (sale_id, product_id, quantity, sell_price, total_price)
    VALUES (v_sale_id, v_product_id, v_quantity, v_sell_price, v_item_total)
    RETURNING id INTO v_sale_item_id;

    FOR v_batch IN
      SELECT id, remaining, cost_price FROM public.inventory_batches
      WHERE product_id = v_product_id AND warehouse_id = _warehouse_id AND remaining > 0
      ORDER BY created_at ASC FOR UPDATE
    LOOP
      EXIT WHEN v_required <= 0;
      v_used := LEAST(v_batch.remaining, v_required);
      UPDATE public.inventory_batches SET remaining = remaining - v_used WHERE id = v_batch.id;

      INSERT INTO public.inventory_movements (type, product_id, warehouse_id, batch_id, quantity, cost_price, ref_type, ref_id, created_by)
      VALUES ('sale', v_product_id, _warehouse_id, v_batch.id, -v_used, v_batch.cost_price, 'sale_item', v_sale_item_id, _user_id);

      v_item_cost := v_item_cost + (v_used * v_batch.cost_price);
      v_required := v_required - v_used;
    END LOOP;

    IF v_required > 0 THEN
      RAISE EXCEPTION 'Not enough stock for product %. Missing: %', v_product_id, v_required;
    END IF;

    UPDATE public.sale_items SET total_cost = v_item_cost WHERE id = v_sale_item_id;
    v_total_sale := v_total_sale + v_item_total;
    v_total_cost := v_total_cost + v_item_cost;
  END LOOP;

  v_remaining_debt := v_total_sale - v_total_paid;

  -- Credit limit enforcement (only if customer set, limit > 0, and there is residual debt)
  IF _customer_id IS NOT NULL AND v_remaining_debt > 0 THEN
    SELECT COALESCE(credit_limit, 0), COALESCE(balance, 0)
      INTO v_credit_limit, v_cur_balance
      FROM public.customers WHERE id = _customer_id FOR UPDATE;
    IF v_credit_limit > 0 THEN
      v_projected_balance := v_cur_balance + v_remaining_debt;
      IF v_projected_balance > v_credit_limit THEN
        RAISE EXCEPTION 'Mijoz qarz limitidan oshib ketadi. Limit: %, prognoz: %', v_credit_limit, v_projected_balance;
      END IF;
    END IF;
  END IF;

  UPDATE public.sales SET
    total_sale = v_total_sale,
    total_cost = v_total_cost,
    profit = v_total_sale - v_total_cost,
    remaining_debt = GREATEST(v_remaining_debt, 0)
  WHERE id = v_sale_id;

  -- Insert payment row(s) — split records cash and click separately
  IF v_cash > 0 THEN
    INSERT INTO public.payments (sale_id, customer_id, amount, method, created_by, shift_id)
    VALUES (v_sale_id, _customer_id, v_cash, 'cash', _user_id, v_shift_id);
  END IF;
  IF v_click > 0 THEN
    INSERT INTO public.payments (sale_id, customer_id, amount, method, created_by, shift_id)
    VALUES (v_sale_id, _customer_id, v_click, 'click', _user_id, v_shift_id);
  END IF;

  IF v_remaining_debt <> 0 AND _customer_id IS NOT NULL THEN
    UPDATE public.customers SET balance = balance + v_remaining_debt WHERE id = _customer_id;
  END IF;

  IF _idempotency_key IS NOT NULL THEN
    INSERT INTO public.idempotency_keys (key, user_id, result_id) VALUES (_idempotency_key, _user_id, v_sale_id);
  END IF;

  RETURN v_sale_id;
END
$function$;