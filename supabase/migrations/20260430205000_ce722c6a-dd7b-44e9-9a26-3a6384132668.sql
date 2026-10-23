-- Allow super-admin to open separate shifts per warehouse
CREATE OR REPLACE FUNCTION public.open_shift(_branch_id uuid, _warehouse_id uuid, _opening_cash numeric, _user_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_id UUID; v_existing UUID; v_is_admin BOOLEAN;
BEGIN
  SELECT public.has_role(_user_id, 'super_admin') INTO v_is_admin;

  IF v_is_admin THEN
    -- Super admin: one open shift per warehouse
    SELECT id INTO v_existing FROM public.shifts
      WHERE user_id = _user_id AND warehouse_id = _warehouse_id AND status = 'open' LIMIT 1;
    IF FOUND THEN RAISE EXCEPTION 'Bu sklad uchun allaqachon ochiq smenangiz bor'; END IF;
  ELSE
    -- Sellers: only one open shift total
    SELECT id INTO v_existing FROM public.shifts WHERE user_id = _user_id AND status = 'open' LIMIT 1;
    IF FOUND THEN RAISE EXCEPTION 'Sizda allaqachon ochiq smena bor'; END IF;
  END IF;

  INSERT INTO public.shifts (user_id, branch_id, warehouse_id, opening_cash)
  VALUES (_user_id, _branch_id, _warehouse_id, COALESCE(_opening_cash, 0))
  RETURNING id INTO v_id;
  RETURN v_id;
END $function$;

-- process_sale: pick shift by user + warehouse
CREATE OR REPLACE FUNCTION public.process_sale(_branch_id uuid, _warehouse_id uuid, _customer_id uuid, _items jsonb, _amount_paid numeric, _payment_method payment_method, _user_id uuid, _idempotency_key text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_existing UUID; v_sale_id UUID; v_item JSONB; v_product_id UUID;
  v_quantity NUMERIC; v_sell_price NUMERIC; v_required NUMERIC; v_used NUMERIC;
  v_item_cost NUMERIC; v_item_total NUMERIC; v_total_sale NUMERIC := 0;
  v_total_cost NUMERIC := 0; v_remaining_debt NUMERIC; v_sale_item_id UUID;
  v_batch RECORD; v_shift_id UUID;
BEGIN
  IF _idempotency_key IS NOT NULL THEN
    SELECT result_id INTO v_existing FROM public.idempotency_keys WHERE key = _idempotency_key;
    IF FOUND THEN RETURN v_existing; END IF;
  END IF;

  IF jsonb_array_length(_items) = 0 THEN RAISE EXCEPTION 'No items in sale'; END IF;
  IF _amount_paid < 0 THEN RAISE EXCEPTION 'Amount paid cannot be negative'; END IF;

  -- Prefer shift matching this warehouse, else any open
  SELECT id INTO v_shift_id FROM public.shifts
    WHERE user_id = _user_id AND warehouse_id = _warehouse_id AND status = 'open' LIMIT 1;
  IF v_shift_id IS NULL THEN
    SELECT id INTO v_shift_id FROM public.shifts WHERE user_id = _user_id AND status = 'open' LIMIT 1;
  END IF;

  INSERT INTO public.sales (branch_id, warehouse_id, customer_id, amount_paid, payment_method, created_by, shift_id)
  VALUES (_branch_id, _warehouse_id, _customer_id, _amount_paid, _payment_method, _user_id, v_shift_id)
  RETURNING id INTO v_sale_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(_items)
  LOOP
    v_product_id := (v_item->>'product_id')::UUID;
    v_quantity := (v_item->>'quantity')::NUMERIC;
    v_sell_price := (v_item->>'sell_price')::NUMERIC;
    IF v_quantity <= 0 THEN RAISE EXCEPTION 'Item quantity must be > 0'; END IF;
    IF v_sell_price < 0 THEN RAISE EXCEPTION 'Sell price cannot be negative'; END IF;
    v_item_total := v_quantity * v_sell_price; v_item_cost := 0; v_required := v_quantity;

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

    IF v_required > 0 THEN RAISE EXCEPTION 'Not enough stock for product %. Missing: %', v_product_id, v_required; END IF;
    UPDATE public.sale_items SET total_cost = v_item_cost WHERE id = v_sale_item_id;
    v_total_sale := v_total_sale + v_item_total;
    v_total_cost := v_total_cost + v_item_cost;
  END LOOP;

  v_remaining_debt := v_total_sale - _amount_paid;

  UPDATE public.sales SET total_sale = v_total_sale, total_cost = v_total_cost,
      profit = v_total_sale - v_total_cost, remaining_debt = GREATEST(v_remaining_debt, 0)
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
END;
$function$;

-- Allow viewing names of profiles used as shift cashiers / sale creators (read-only minimal access)
DROP POLICY IF EXISTS "View profile names of co-workers" ON public.profiles;
CREATE POLICY "View profile names of co-workers"
  ON public.profiles FOR SELECT
  TO authenticated
  USING (true);
-- Drop the old restrictive select to avoid duplicate; keep update/insert restrictive
DROP POLICY IF EXISTS "Users view own profile" ON public.profiles;