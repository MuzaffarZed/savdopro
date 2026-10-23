-- 1) Add FK so PostgREST embed `products(name)` works on transfer_items
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'transfer_items_product_id_fkey' 
      AND conrelid = 'public.transfer_items'::regclass
  ) THEN
    ALTER TABLE public.transfer_items
      ADD CONSTRAINT transfer_items_product_id_fkey
      FOREIGN KEY (product_id) REFERENCES public.products(id);
  END IF;
END $$;

-- 2) Authoritative customer balance recalculation
CREATE OR REPLACE FUNCTION public.recalc_customer_balance(_customer_id uuid)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_sales_debt numeric := 0;
  v_standalone_paid numeric := 0;
  v_balance numeric := 0;
BEGIN
  IF _customer_id IS NULL THEN RETURN 0; END IF;

  -- Sum remaining_debt across completed sales
  SELECT COALESCE(SUM(remaining_debt), 0) INTO v_sales_debt
  FROM public.sales
  WHERE customer_id = _customer_id AND status = 'completed';

  -- Sum standalone debt payments (not linked to a specific sale)
  SELECT COALESCE(SUM(amount), 0) INTO v_standalone_paid
  FROM public.payments
  WHERE customer_id = _customer_id AND sale_id IS NULL;

  v_balance := v_sales_debt - v_standalone_paid;

  UPDATE public.customers SET balance = v_balance WHERE id = _customer_id;
  RETURN v_balance;
END;
$$;

-- 3) Improved delete_payment that always recalculates balance at the end
CREATE OR REPLACE FUNCTION public.delete_payment(_payment_id uuid, _user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_pay RECORD;
  v_sale RECORD;
  v_amount NUMERIC;
  v_customer_id uuid;
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Faqat super-admin to''lovni o''chira oladi';
  END IF;

  SELECT * INTO v_pay FROM public.payments WHERE id = _payment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'To''lov topilmadi'; END IF;

  v_amount := v_pay.amount;
  v_customer_id := v_pay.customer_id;

  IF v_pay.sale_id IS NOT NULL THEN
    SELECT * INTO v_sale FROM public.sales WHERE id = v_pay.sale_id FOR UPDATE;
    IF FOUND THEN
      UPDATE public.sales
        SET amount_paid = GREATEST(amount_paid - v_amount, 0),
            remaining_debt = LEAST(remaining_debt + v_amount, total_sale)
        WHERE id = v_sale.id;
      IF v_customer_id IS NULL THEN v_customer_id := v_sale.customer_id; END IF;
    END IF;
  END IF;

  DELETE FROM public.payments WHERE id = _payment_id;

  -- Always recompute the canonical balance from data
  IF v_customer_id IS NOT NULL THEN
    PERFORM public.recalc_customer_balance(v_customer_id);
  END IF;
END;
$$;

-- 4) Also update payments.update path: when a sale-linked payment amount is edited
-- we cannot easily migrate without RPC, but at least expose recalc for client to call.
GRANT EXECUTE ON FUNCTION public.recalc_customer_balance(uuid) TO authenticated;