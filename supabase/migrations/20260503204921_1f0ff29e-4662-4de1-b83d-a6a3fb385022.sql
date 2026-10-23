CREATE OR REPLACE FUNCTION public.process_debt_payment(_customer_id uuid, _amount numeric, _method payment_method, _note text, _user_id uuid, _idempotency_key text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_existing uuid;
  v_payment_id uuid;
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

  PERFORM public.recalc_customer_balance(_customer_id);

  IF _idempotency_key IS NOT NULL THEN
    INSERT INTO public.idempotency_keys (key, user_id, result_id)
    VALUES (_idempotency_key, _user_id, v_payment_id);
  END IF;

  RETURN v_payment_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.recalc_customer_balance(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.process_debt_payment(uuid, numeric, payment_method, text, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.recalc_customer_balance(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.process_debt_payment(uuid, numeric, payment_method, text, uuid, text) TO authenticated;