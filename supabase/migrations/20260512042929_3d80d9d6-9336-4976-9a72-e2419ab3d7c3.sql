CREATE OR REPLACE FUNCTION public.recalc_customer_balance(_customer_id uuid)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_opening numeric := 0;
  v_sales numeric := 0;
  v_paid numeric := 0;
  v_balance numeric := 0;
BEGIN
  IF _customer_id IS NULL THEN
    RETURN 0;
  END IF;

  SELECT COALESCE(opening_balance, 0) INTO v_opening
  FROM public.customers WHERE id = _customer_id;

  SELECT COALESCE(SUM(total_sale), 0) INTO v_sales
  FROM public.sales
  WHERE customer_id = _customer_id AND status = 'completed';

  SELECT COALESCE(SUM(amount), 0) INTO v_paid
  FROM public.payments
  WHERE customer_id = _customer_id;

  v_balance := v_opening + v_sales - v_paid;

  UPDATE public.customers SET balance = v_balance WHERE id = _customer_id;

  RETURN v_balance;
END;
$function$;

DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT id FROM public.customers WHERE deleted_at IS NULL LOOP
    PERFORM public.recalc_customer_balance(r.id);
  END LOOP;
END $$;