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
  v_orphan_sales int;
  v_orphan_payments int;
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

  -- Block closing if there are unlinked (orphan) sales/payments in this branch since shift opened
  SELECT COUNT(*) INTO v_orphan_sales
  FROM public.sales
  WHERE branch_id = v_shift.branch_id
    AND warehouse_id = v_shift.warehouse_id
    AND created_at >= v_shift.opened_at
    AND shift_id IS NULL
    AND status = 'completed';

  SELECT COUNT(*) INTO v_orphan_payments
  FROM public.payments p
  WHERE p.created_at >= v_shift.opened_at
    AND p.shift_id IS NULL
    AND (
      p.sale_id IN (SELECT id FROM public.sales WHERE branch_id = v_shift.branch_id)
      OR p.customer_id IN (SELECT id FROM public.customers WHERE branch_id = v_shift.branch_id)
    );

  IF v_orphan_sales > 0 OR v_orphan_payments > 0 THEN
    RAISE EXCEPTION 'Smenaga bog''lanmagan % ta sotuv va % ta to''lov mavjud — smenani yopib bo''lmaydi', v_orphan_sales, v_orphan_payments;
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