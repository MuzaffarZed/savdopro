ALTER TABLE public.customers
ADD COLUMN IF NOT EXISTS opening_balance numeric NOT NULL DEFAULT 0;

UPDATE public.customers c
SET opening_balance = GREATEST(
  COALESCE(c.balance, 0)
  - COALESCE((
    SELECT SUM(s.remaining_debt)
    FROM public.sales s
    WHERE s.customer_id = c.id
      AND s.status = 'completed'
  ), 0)
  + COALESCE((
    SELECT SUM(p.amount)
    FROM public.payments p
    WHERE p.customer_id = c.id
      AND p.sale_id IS NULL
  ), 0),
  0
)
WHERE c.opening_balance = 0;

CREATE OR REPLACE FUNCTION public.recalc_customer_balance(_customer_id uuid)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_opening_balance numeric := 0;
  v_sales_debt numeric := 0;
  v_standalone_paid numeric := 0;
  v_balance numeric := 0;
BEGIN
  IF _customer_id IS NULL THEN
    RETURN 0;
  END IF;

  SELECT COALESCE(c.opening_balance, 0)
    INTO v_opening_balance
  FROM public.customers c
  WHERE c.id = _customer_id;

  SELECT COALESCE(SUM(s.remaining_debt), 0)
    INTO v_sales_debt
  FROM public.sales s
  WHERE s.customer_id = _customer_id
    AND s.status = 'completed';

  SELECT COALESCE(SUM(p.amount), 0)
    INTO v_standalone_paid
  FROM public.payments p
  WHERE p.customer_id = _customer_id
    AND p.sale_id IS NULL;

  v_balance := GREATEST(v_opening_balance + v_sales_debt - v_standalone_paid, 0);

  UPDATE public.customers
  SET balance = v_balance
  WHERE id = _customer_id;

  RETURN v_balance;
END;
$$;

CREATE OR REPLACE FUNCTION public.process_debt_payment(_customer_id uuid, _amount numeric, _method payment_method, _note text, _user_id uuid, _idempotency_key text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
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
    IF FOUND THEN
      RETURN v_existing;
    END IF;
  END IF;

  IF _amount <= 0 THEN
    RAISE EXCEPTION 'Summa musbat bo''lishi kerak';
  END IF;
  IF _customer_id IS NULL THEN
    RAISE EXCEPTION 'Mijoz tanlanishi shart';
  END IF;

  SELECT branch_id INTO v_branch_id
  FROM public.customers
  WHERE id = _customer_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Mijoz topilmadi';
  END IF;

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

  v_remaining := _amount;
  FOR v_sale IN
    SELECT id, remaining_debt
    FROM public.sales
    WHERE customer_id = _customer_id
      AND remaining_debt > 0
      AND status = 'completed'
    ORDER BY created_at ASC
    FOR UPDATE
  LOOP
    EXIT WHEN v_remaining <= 0;
    v_used := LEAST(v_sale.remaining_debt, v_remaining);

    UPDATE public.sales
    SET remaining_debt = GREATEST(remaining_debt - v_used, 0),
        amount_paid = amount_paid + v_used
    WHERE id = v_sale.id;

    v_remaining := v_remaining - v_used;
  END LOOP;

  PERFORM public.recalc_customer_balance(_customer_id);

  IF _idempotency_key IS NOT NULL THEN
    INSERT INTO public.idempotency_keys (key, user_id, result_id)
    VALUES (_idempotency_key, _user_id, v_payment_id);
  END IF;

  RETURN v_payment_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.recalc_customer_balance(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.process_debt_payment(uuid, numeric, payment_method, text, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.recalc_customer_balance(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.process_debt_payment(uuid, numeric, payment_method, text, uuid, text) TO authenticated;

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT id FROM public.customers LOOP
    PERFORM public.recalc_customer_balance(r.id);
  END LOOP;
END $$;