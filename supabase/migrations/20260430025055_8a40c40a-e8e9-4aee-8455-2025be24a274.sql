CREATE OR REPLACE FUNCTION public.process_debt_payment(
  _customer_id UUID,
  _amount NUMERIC,
  _method payment_method,
  _note TEXT,
  _user_id UUID,
  _idempotency_key TEXT
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing UUID;
  v_payment_id UUID;
  v_remaining NUMERIC;
  v_used NUMERIC;
  v_sale RECORD;
BEGIN
  IF _idempotency_key IS NOT NULL THEN
    SELECT result_id INTO v_existing FROM public.idempotency_keys WHERE key = _idempotency_key;
    IF FOUND THEN RETURN v_existing; END IF;
  END IF;

  IF _amount <= 0 THEN RAISE EXCEPTION 'Amount must be positive'; END IF;
  IF _customer_id IS NULL THEN RAISE EXCEPTION 'Customer required'; END IF;

  -- Insert payment
  INSERT INTO public.payments (customer_id, amount, method, note, created_by)
  VALUES (_customer_id, _amount, _method, _note, _user_id)
  RETURNING id INTO v_payment_id;

  -- Reduce customer balance
  UPDATE public.customers SET balance = balance - _amount WHERE id = _customer_id;

  -- Apply FIFO to oldest unpaid sales
  v_remaining := _amount;
  FOR v_sale IN
    SELECT id, remaining_debt FROM public.sales
    WHERE customer_id = _customer_id AND remaining_debt > 0 AND status = 'completed'
    ORDER BY created_at ASC
    FOR UPDATE
  LOOP
    EXIT WHEN v_remaining <= 0;
    v_used := LEAST(v_sale.remaining_debt, v_remaining);
    UPDATE public.sales
      SET remaining_debt = remaining_debt - v_used,
          amount_paid = amount_paid + v_used
      WHERE id = v_sale.id;
    v_remaining := v_remaining - v_used;
  END LOOP;

  IF _idempotency_key IS NOT NULL THEN
    INSERT INTO public.idempotency_keys (key, user_id, result_id) VALUES (_idempotency_key, _user_id, v_payment_id);
  END IF;

  RETURN v_payment_id;
END $$;