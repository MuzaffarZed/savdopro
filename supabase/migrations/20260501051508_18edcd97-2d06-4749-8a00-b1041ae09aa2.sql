CREATE OR REPLACE FUNCTION public.open_shift(
  _branch_id uuid,
  _warehouse_id uuid,
  _opening_cash numeric,
  _user_id uuid,
  _target_user_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid;
  v_existing uuid;
  v_allowed boolean;
BEGIN
  IF auth.uid() IS NULL OR auth.uid() <> _user_id THEN
    RAISE EXCEPTION 'Ruxsat yo''q';
  END IF;

  SELECT (
    public.is_super_admin()
    OR _branch_id = public.get_user_branch(_user_id)
  ) INTO v_allowed;

  IF NOT v_allowed THEN
    RAISE EXCEPTION 'Bu filial uchun smena ochishga ruxsat yo''q';
  END IF;

  SELECT id INTO v_existing
  FROM public.shifts
  WHERE warehouse_id = _warehouse_id
    AND branch_id = _branch_id
    AND status = 'open'
  LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION 'Bu sklad uchun allaqachon ochiq smena bor';
  END IF;

  INSERT INTO public.shifts (user_id, branch_id, warehouse_id, opening_cash)
  VALUES (_user_id, _branch_id, _warehouse_id, COALESCE(_opening_cash, 0))
  RETURNING id INTO v_id;

  RETURN v_id;
END
$function$;

CREATE OR REPLACE FUNCTION public.close_shift(_shift_id uuid, _closing_cash numeric, _note text, _user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_shift record;
  v_cash numeric;
  v_click numeric;
  v_debt numeric;
  v_sales numeric;
  v_count int;
  v_expected numeric;
  v_allowed boolean;
BEGIN
  IF auth.uid() IS NULL OR auth.uid() <> _user_id THEN
    RAISE EXCEPTION 'Ruxsat yo''q';
  END IF;

  SELECT * INTO v_shift FROM public.shifts WHERE id = _shift_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Smena topilmadi'; END IF;
  IF v_shift.status <> 'open' THEN RAISE EXCEPTION 'Smena allaqachon yopilgan'; END IF;

  SELECT (
    public.is_super_admin()
    OR v_shift.branch_id = public.get_user_branch(_user_id)
  ) INTO v_allowed;

  IF NOT v_allowed THEN
    RAISE EXCEPTION 'Bu smenani yopishga ruxsat yo''q';
  END IF;

  SELECT
    COALESCE(SUM(total_sale), 0),
    COALESCE(SUM(CASE WHEN payment_method = 'cash' THEN amount_paid ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN payment_method = 'click' THEN amount_paid ELSE 0 END), 0),
    COALESCE(SUM(remaining_debt), 0),
    COUNT(*)
  INTO v_sales, v_cash, v_click, v_debt, v_count
  FROM public.sales
  WHERE shift_id = _shift_id AND status = 'completed';

  v_cash := v_cash + COALESCE((
    SELECT SUM(amount) FROM public.payments
    WHERE shift_id = _shift_id AND method = 'cash' AND sale_id IS NULL
  ), 0);

  v_click := v_click + COALESCE((
    SELECT SUM(amount) FROM public.payments
    WHERE shift_id = _shift_id AND method = 'click' AND sale_id IS NULL
  ), 0);

  v_expected := v_shift.opening_cash + v_cash;

  UPDATE public.shifts SET
    closed_at = now(),
    closing_cash = _closing_cash,
    expected_cash = v_expected,
    difference = COALESCE(_closing_cash, 0) - v_expected,
    total_sales = v_sales,
    total_cash = v_cash,
    total_click = v_click,
    total_debt = v_debt,
    sales_count = v_count,
    note = _note,
    status = 'closed'
  WHERE id = _shift_id;
END
$function$;

CREATE OR REPLACE FUNCTION public.process_sale(_branch_id uuid, _warehouse_id uuid, _customer_id uuid, _items jsonb, _amount_paid numeric, _payment_method payment_method, _user_id uuid, _idempotency_key text)
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
BEGIN
  IF auth.uid() IS NULL OR auth.uid() <> _user_id THEN
    RAISE EXCEPTION 'Ruxsat yo''q';
  END IF;

  IF _idempotency_key IS NOT NULL THEN
    SELECT result_id INTO v_existing FROM public.idempotency_keys WHERE key = _idempotency_key;
    IF FOUND THEN RETURN v_existing; END IF;
  END IF;

  IF jsonb_array_length(_items) = 0 THEN RAISE EXCEPTION 'No items in sale'; END IF;
  IF _amount_paid < 0 THEN RAISE EXCEPTION 'Amount paid cannot be negative'; END IF;

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
  VALUES (_branch_id, _warehouse_id, _customer_id, _amount_paid, _payment_method, _user_id, v_shift_id)
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

  v_remaining_debt := v_total_sale - _amount_paid;

  UPDATE public.sales SET
    total_sale = v_total_sale,
    total_cost = v_total_cost,
    profit = v_total_sale - v_total_cost,
    remaining_debt = GREATEST(v_remaining_debt, 0)
  WHERE id = v_sale_id;

  IF _amount_paid > 0 THEN
    INSERT INTO public.payments (sale_id, customer_id, amount, method, created_by, shift_id)
    VALUES (v_sale_id, _customer_id, _amount_paid, _payment_method, _user_id, v_shift_id);
  END IF;

  IF v_remaining_debt > 0 AND _customer_id IS NOT NULL THEN
    UPDATE public.customers SET balance = balance + v_remaining_debt WHERE id = _customer_id;
  ELSIF v_remaining_debt < 0 AND _customer_id IS NOT NULL THEN
    UPDATE public.customers SET balance = balance + v_remaining_debt WHERE id = _customer_id;
  END IF;

  IF _idempotency_key IS NOT NULL THEN
    INSERT INTO public.idempotency_keys (key, user_id, result_id) VALUES (_idempotency_key, _user_id, v_sale_id);
  END IF;

  RETURN v_sale_id;
END
$function$;

CREATE OR REPLACE FUNCTION public.process_debt_payment(_customer_id uuid, _amount numeric, _method payment_method, _note text, _user_id uuid, _idempotency_key text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_existing uuid;
  v_payment_id uuid;
  v_remaining numeric;
  v_used numeric;
  v_sale record;
  v_shift_id uuid;
  v_branch_id uuid;
BEGIN
  IF auth.uid() IS NULL OR auth.uid() <> _user_id THEN
    RAISE EXCEPTION 'Ruxsat yo''q';
  END IF;

  IF _idempotency_key IS NOT NULL THEN
    SELECT result_id INTO v_existing FROM public.idempotency_keys WHERE key = _idempotency_key;
    IF FOUND THEN RETURN v_existing; END IF;
  END IF;

  IF _amount <= 0 THEN RAISE EXCEPTION 'Amount must be positive'; END IF;
  IF _customer_id IS NULL THEN RAISE EXCEPTION 'Customer required'; END IF;

  SELECT branch_id INTO v_branch_id FROM public.customers WHERE id = _customer_id;
  v_branch_id := COALESCE(v_branch_id, public.get_user_branch(_user_id));

  SELECT id INTO v_shift_id
  FROM public.shifts
  WHERE branch_id = v_branch_id
    AND status = 'open'
  ORDER BY opened_at DESC
  LIMIT 1;

  INSERT INTO public.payments (customer_id, amount, method, note, created_by, shift_id)
  VALUES (_customer_id, _amount, _method, _note, _user_id, v_shift_id)
  RETURNING id INTO v_payment_id;

  UPDATE public.customers SET balance = balance - _amount WHERE id = _customer_id;

  v_remaining := _amount;
  FOR v_sale IN
    SELECT id, remaining_debt FROM public.sales
    WHERE customer_id = _customer_id AND remaining_debt > 0 AND status = 'completed'
    ORDER BY created_at ASC FOR UPDATE
  LOOP
    EXIT WHEN v_remaining <= 0;
    v_used := LEAST(v_sale.remaining_debt, v_remaining);
    UPDATE public.sales SET remaining_debt = remaining_debt - v_used, amount_paid = amount_paid + v_used WHERE id = v_sale.id;
    v_remaining := v_remaining - v_used;
  END LOOP;

  IF _idempotency_key IS NOT NULL THEN
    INSERT INTO public.idempotency_keys (key, user_id, result_id) VALUES (_idempotency_key, _user_id, v_payment_id);
  END IF;

  RETURN v_payment_id;
END
$function$;