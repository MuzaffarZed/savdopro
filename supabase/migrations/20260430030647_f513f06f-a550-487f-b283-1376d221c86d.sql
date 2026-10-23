
-- 1. Shifts table
CREATE TABLE public.shifts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  branch_id UUID,
  warehouse_id UUID,
  opened_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at TIMESTAMPTZ,
  opening_cash NUMERIC NOT NULL DEFAULT 0,
  closing_cash NUMERIC,
  expected_cash NUMERIC,
  difference NUMERIC,
  total_sales NUMERIC NOT NULL DEFAULT 0,
  total_cash NUMERIC NOT NULL DEFAULT 0,
  total_click NUMERIC NOT NULL DEFAULT 0,
  total_debt NUMERIC NOT NULL DEFAULT 0,
  sales_count INTEGER NOT NULL DEFAULT 0,
  note TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_shifts_user_open ON public.shifts(user_id) WHERE status = 'open';
CREATE INDEX idx_shifts_branch ON public.shifts(branch_id);

ALTER TABLE public.shifts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "View own or admin shifts" ON public.shifts FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR is_super_admin() OR branch_id = get_user_branch(auth.uid()));

-- 2. Add shift_id to sales and payments
ALTER TABLE public.sales ADD COLUMN shift_id UUID;
ALTER TABLE public.payments ADD COLUMN shift_id UUID;

CREATE INDEX idx_sales_shift ON public.sales(shift_id);
CREATE INDEX idx_payments_shift ON public.payments(shift_id);

-- 3. open_shift
CREATE OR REPLACE FUNCTION public.open_shift(_branch_id UUID, _warehouse_id UUID, _opening_cash NUMERIC, _user_id UUID)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id UUID; v_existing UUID;
BEGIN
  SELECT id INTO v_existing FROM public.shifts WHERE user_id = _user_id AND status = 'open' LIMIT 1;
  IF FOUND THEN RAISE EXCEPTION 'Sizda allaqachon ochiq smena bor'; END IF;
  INSERT INTO public.shifts (user_id, branch_id, warehouse_id, opening_cash)
  VALUES (_user_id, _branch_id, _warehouse_id, COALESCE(_opening_cash, 0))
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

-- 4. close_shift
CREATE OR REPLACE FUNCTION public.close_shift(_shift_id UUID, _closing_cash NUMERIC, _note TEXT, _user_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_shift RECORD; v_cash NUMERIC; v_click NUMERIC; v_debt NUMERIC; v_sales NUMERIC; v_count INT; v_expected NUMERIC;
BEGIN
  SELECT * INTO v_shift FROM public.shifts WHERE id = _shift_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Smena topilmadi'; END IF;
  IF v_shift.status <> 'open' THEN RAISE EXCEPTION 'Smena allaqachon yopilgan'; END IF;
  IF v_shift.user_id <> _user_id AND NOT is_super_admin() THEN RAISE EXCEPTION 'Ruxsat yo''q'; END IF;

  SELECT
    COALESCE(SUM(total_sale),0),
    COALESCE(SUM(CASE WHEN payment_method='cash' THEN amount_paid ELSE 0 END),0),
    COALESCE(SUM(CASE WHEN payment_method='click' THEN amount_paid ELSE 0 END),0),
    COALESCE(SUM(remaining_debt),0),
    COUNT(*)
  INTO v_sales, v_cash, v_click, v_debt, v_count
  FROM public.sales WHERE shift_id = _shift_id AND status = 'completed';

  -- Add debt payments cash/click that came in during shift
  v_cash := v_cash + COALESCE((SELECT SUM(amount) FROM public.payments WHERE shift_id = _shift_id AND method='cash' AND sale_id IS NULL), 0);
  v_click := v_click + COALESCE((SELECT SUM(amount) FROM public.payments WHERE shift_id = _shift_id AND method='click' AND sale_id IS NULL), 0);

  v_expected := v_shift.opening_cash + v_cash;

  UPDATE public.shifts SET
    closed_at = now(),
    closing_cash = _closing_cash,
    expected_cash = v_expected,
    difference = COALESCE(_closing_cash,0) - v_expected,
    total_sales = v_sales,
    total_cash = v_cash,
    total_click = v_click,
    total_debt = v_debt,
    sales_count = v_count,
    note = _note,
    status = 'closed'
  WHERE id = _shift_id;
END $$;

-- 5. Update process_sale to attach current open shift
CREATE OR REPLACE FUNCTION public.process_sale(_branch_id uuid, _warehouse_id uuid, _customer_id uuid, _items jsonb, _amount_paid numeric, _payment_method payment_method, _user_id uuid, _idempotency_key text)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
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

  SELECT id INTO v_shift_id FROM public.shifts WHERE user_id = _user_id AND status = 'open' LIMIT 1;

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

-- 6. Update process_debt_payment to attach shift
CREATE OR REPLACE FUNCTION public.process_debt_payment(_customer_id uuid, _amount numeric, _method payment_method, _note text, _user_id uuid, _idempotency_key text)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_existing UUID; v_payment_id UUID; v_remaining NUMERIC; v_used NUMERIC; v_sale RECORD; v_shift_id UUID;
BEGIN
  IF _idempotency_key IS NOT NULL THEN
    SELECT result_id INTO v_existing FROM public.idempotency_keys WHERE key = _idempotency_key;
    IF FOUND THEN RETURN v_existing; END IF;
  END IF;
  IF _amount <= 0 THEN RAISE EXCEPTION 'Amount must be positive'; END IF;
  IF _customer_id IS NULL THEN RAISE EXCEPTION 'Customer required'; END IF;

  SELECT id INTO v_shift_id FROM public.shifts WHERE user_id = _user_id AND status = 'open' LIMIT 1;

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
END $function$;

-- 7. Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.shifts;
