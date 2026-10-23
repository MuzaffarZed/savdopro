CREATE OR REPLACE FUNCTION public.delete_customer(_customer_id uuid, _user_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_customer RECORD;
  v_has_sales BOOLEAN;
  v_has_payments BOOLEAN;
BEGIN
  SELECT * INTO v_customer FROM public.customers WHERE id = _customer_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Mijoz topilmadi'; END IF;

  -- Permission: super admin or same branch
  IF NOT (
    public.is_super_admin()
    OR v_customer.branch_id IS NULL
    OR v_customer.branch_id = public.get_user_branch(_user_id)
  ) THEN
    RAISE EXCEPTION 'Bu mijozni o''chirishga ruxsat yo''q';
  END IF;

  SELECT EXISTS(SELECT 1 FROM public.sales WHERE customer_id = _customer_id) INTO v_has_sales;
  SELECT EXISTS(SELECT 1 FROM public.payments WHERE customer_id = _customer_id) INTO v_has_payments;

  IF v_has_sales OR v_has_payments THEN
    -- Soft delete: keep history intact
    UPDATE public.customers
      SET deleted_at = now()
      WHERE id = _customer_id;
    RETURN 'archived';
  ELSE
    -- Hard delete: no references
    DELETE FROM public.customers WHERE id = _customer_id;
    RETURN 'deleted';
  END IF;
END;
$$;