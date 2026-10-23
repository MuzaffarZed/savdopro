CREATE OR REPLACE FUNCTION public.recalc_customer_balance(_customer_id uuid)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  -- Allow negative balance for prepayments (customer overpaid → we owe them)
  v_balance := v_opening_balance + v_sales_debt - v_standalone_paid;

  UPDATE public.customers
  SET balance = v_balance
  WHERE id = _customer_id;

  RETURN v_balance;
END;
$function$;

-- Recompute every customer's balance with the corrected formula
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT id FROM public.customers LOOP
    PERFORM public.recalc_customer_balance(r.id);
  END LOOP;
END $$;