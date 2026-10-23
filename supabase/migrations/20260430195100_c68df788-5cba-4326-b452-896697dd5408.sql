-- Super admin: hard delete a sale (rolls back FIFO, debt, then removes records)
CREATE OR REPLACE FUNCTION public.delete_sale(_sale_id uuid, _user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sale RECORD;
  v_mov RECORD;
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Faqat super-admin sotuvni o''chira oladi';
  END IF;

  SELECT * INTO v_sale FROM public.sales WHERE id = _sale_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Sotuv topilmadi'; END IF;

  -- If still completed, restore FIFO + reverse customer debt
  IF v_sale.status = 'completed' THEN
    FOR v_mov IN
      SELECT batch_id, quantity
      FROM public.inventory_movements
      WHERE ref_type = 'sale_item' AND type = 'sale'
        AND ref_id IN (SELECT id FROM public.sale_items WHERE sale_id = _sale_id)
    LOOP
      UPDATE public.inventory_batches
        SET remaining = remaining + ABS(v_mov.quantity)
        WHERE id = v_mov.batch_id;
    END LOOP;

    -- Reverse customer balance: previously +remaining_debt was added (or negative for overpayment)
    IF v_sale.customer_id IS NOT NULL AND v_sale.remaining_debt <> 0 THEN
      UPDATE public.customers SET balance = balance - v_sale.remaining_debt WHERE id = v_sale.customer_id;
    END IF;
  END IF;

  -- Reverse standalone payment effect on customer balance:
  -- Payments tied to this sale (sale_id IS NOT NULL) reduced amount_paid effect — for completed sales,
  -- amount_paid was applied via remaining_debt calc above. For standalone debt repayments not linked to this sale,
  -- they're separate and untouched.

  -- Cleanup movements/items/payments
  DELETE FROM public.inventory_movements
    WHERE ref_type IN ('sale_item','sale_rollback')
      AND (ref_id = _sale_id OR ref_id IN (SELECT id FROM public.sale_items WHERE sale_id = _sale_id));
  DELETE FROM public.payments WHERE sale_id = _sale_id;
  DELETE FROM public.sale_items WHERE sale_id = _sale_id;
  DELETE FROM public.sales WHERE id = _sale_id;
END;
$$;

-- Super admin: edit sale payment details (amount/method/customer)
CREATE OR REPLACE FUNCTION public.update_sale_payment(
  _sale_id uuid,
  _amount_paid numeric,
  _payment_method payment_method,
  _customer_id uuid,
  _user_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sale RECORD;
  v_old_debt NUMERIC;
  v_new_debt NUMERIC;
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Faqat super-admin tahrirlay oladi';
  END IF;
  IF _amount_paid < 0 THEN RAISE EXCEPTION 'To''langan summa manfiy bo''lmaydi'; END IF;

  SELECT * INTO v_sale FROM public.sales WHERE id = _sale_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Sotuv topilmadi'; END IF;
  IF v_sale.status <> 'completed' THEN RAISE EXCEPTION 'Faqat completed sotuvni tahrirlash mumkin'; END IF;

  v_old_debt := v_sale.remaining_debt;
  v_new_debt := GREATEST(v_sale.total_sale - _amount_paid, 0);

  -- Reverse old debt from old customer
  IF v_sale.customer_id IS NOT NULL AND v_old_debt <> 0 THEN
    UPDATE public.customers SET balance = balance - v_old_debt WHERE id = v_sale.customer_id;
  END IF;

  -- Apply new debt to new customer
  IF _customer_id IS NOT NULL AND v_new_debt <> 0 THEN
    UPDATE public.customers SET balance = balance + v_new_debt WHERE id = _customer_id;
  END IF;

  -- Update the sale
  UPDATE public.sales
    SET amount_paid = _amount_paid,
        payment_method = _payment_method,
        customer_id = _customer_id,
        remaining_debt = v_new_debt
    WHERE id = _sale_id;

  -- Sync the primary payment record tied to this sale
  DELETE FROM public.payments WHERE sale_id = _sale_id;
  IF _amount_paid > 0 THEN
    INSERT INTO public.payments (sale_id, customer_id, amount, method, created_by, shift_id)
    VALUES (_sale_id, _customer_id, _amount_paid, _payment_method, _user_id, v_sale.shift_id);
  END IF;
END;
$$;