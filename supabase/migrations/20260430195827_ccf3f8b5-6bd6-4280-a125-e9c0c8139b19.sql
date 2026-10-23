
-- 1) Audit log table for transfer edits/deletes
CREATE TABLE IF NOT EXISTS public.transfer_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transfer_id UUID NOT NULL,
  action TEXT NOT NULL, -- 'update_note' | 'delete'
  actor_id UUID,
  old_note TEXT,
  new_note TEXT,
  snapshot JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.transfer_audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Super admin views transfer audit" ON public.transfer_audit_log;
CREATE POLICY "Super admin views transfer audit"
ON public.transfer_audit_log FOR SELECT
TO authenticated
USING (public.is_super_admin());

CREATE INDEX IF NOT EXISTS idx_transfer_audit_log_transfer_id ON public.transfer_audit_log(transfer_id);
CREATE INDEX IF NOT EXISTS idx_transfer_audit_log_created_at ON public.transfer_audit_log(created_at DESC);

-- 2) Update update_transfer_note to log old/new note
CREATE OR REPLACE FUNCTION public.update_transfer_note(_transfer_id uuid, _note text, _user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_old_note TEXT;
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Faqat super-admin tahrirlay oladi';
  END IF;
  SELECT note INTO v_old_note FROM public.transfers WHERE id = _transfer_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Transfer topilmadi'; END IF;

  UPDATE public.transfers SET note = _note WHERE id = _transfer_id;

  INSERT INTO public.transfer_audit_log (transfer_id, action, actor_id, old_note, new_note)
  VALUES (_transfer_id, 'update_note', _user_id, v_old_note, _note);
END;
$function$;

-- 3) Update delete_transfer to capture snapshot before deletion
CREATE OR REPLACE FUNCTION public.delete_transfer(_transfer_id uuid, _user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_item RECORD;
  v_dest RECORD;
  v_snapshot JSONB;
  v_old_note TEXT;
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Faqat super-admin transferni o''chira oladi';
  END IF;

  -- Build snapshot
  SELECT jsonb_build_object(
    'transfer', to_jsonb(t.*),
    'items', COALESCE((SELECT jsonb_agg(to_jsonb(ti.*)) FROM public.transfer_items ti WHERE ti.transfer_id = t.id), '[]'::jsonb)
  ), t.note
  INTO v_snapshot, v_old_note
  FROM public.transfers t WHERE t.id = _transfer_id;

  IF v_snapshot IS NULL THEN RAISE EXCEPTION 'Transfer topilmadi'; END IF;

  -- Validate: every dest_batch must be fully intact (remaining = quantity)
  FOR v_item IN
    SELECT ti.dest_batch_id, ti.source_batch_id, ti.quantity, ti.cost_price, ti.product_id
    FROM public.transfer_items ti
    WHERE ti.transfer_id = _transfer_id
  LOOP
    SELECT * INTO v_dest FROM public.inventory_batches WHERE id = v_item.dest_batch_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Manzil partiya topilmadi'; END IF;
    IF v_dest.remaining <> v_dest.quantity THEN
      RAISE EXCEPTION 'Bu transferdan mahsulot sotilgan/ko''chirilgan — o''chirib bo''lmaydi';
    END IF;
  END LOOP;

  -- Reverse: restore source remaining, delete dest batch, delete movements
  FOR v_item IN
    SELECT ti.dest_batch_id, ti.source_batch_id, ti.quantity
    FROM public.transfer_items ti
    WHERE ti.transfer_id = _transfer_id
  LOOP
    UPDATE public.inventory_batches
      SET remaining = remaining + v_item.quantity
      WHERE id = v_item.source_batch_id;

    DELETE FROM public.inventory_movements WHERE batch_id = v_item.dest_batch_id;
    DELETE FROM public.inventory_movements
      WHERE ref_type = 'transfer' AND ref_id = _transfer_id AND batch_id = v_item.source_batch_id;

    DELETE FROM public.inventory_batches WHERE id = v_item.dest_batch_id;
  END LOOP;

  DELETE FROM public.inventory_movements WHERE ref_type = 'transfer' AND ref_id = _transfer_id;
  DELETE FROM public.transfer_items WHERE transfer_id = _transfer_id;
  DELETE FROM public.transfers WHERE id = _transfer_id;

  -- Log after successful delete
  INSERT INTO public.transfer_audit_log (transfer_id, action, actor_id, old_note, snapshot)
  VALUES (_transfer_id, 'delete', _user_id, v_old_note, v_snapshot);
END;
$function$;

-- 4) delete_payment: safely delete a payment and recalc customer debt
CREATE OR REPLACE FUNCTION public.delete_payment(_payment_id uuid, _user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_pay RECORD;
  v_sale RECORD;
  v_amount NUMERIC;
  v_remaining NUMERIC;
  v_take NUMERIC;
  v_si RECORD;
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Faqat super-admin to''lovni o''chira oladi';
  END IF;

  SELECT * INTO v_pay FROM public.payments WHERE id = _payment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'To''lov topilmadi'; END IF;

  v_amount := v_pay.amount;

  IF v_pay.sale_id IS NOT NULL THEN
    -- Sale-linked payment: restore remaining_debt + reduce amount_paid on the sale
    SELECT * INTO v_sale FROM public.sales WHERE id = v_pay.sale_id FOR UPDATE;
    IF FOUND THEN
      UPDATE public.sales
        SET amount_paid = GREATEST(amount_paid - v_amount, 0),
            remaining_debt = LEAST(remaining_debt + v_amount, total_sale)
        WHERE id = v_sale.id;

      -- Increase customer debt back if customer exists
      IF v_sale.customer_id IS NOT NULL THEN
        UPDATE public.customers SET balance = balance + v_amount WHERE id = v_sale.customer_id;
      END IF;
    END IF;
  ELSIF v_pay.customer_id IS NOT NULL THEN
    -- Standalone debt payment: customer balance was reduced by amount; restore it
    UPDATE public.customers SET balance = balance + v_amount WHERE id = v_pay.customer_id;

    -- Re-apply the reverse FIFO: increase remaining_debt on most recently paid-off sales
    v_remaining := v_amount;
    FOR v_si IN
      SELECT id, total_sale, amount_paid, remaining_debt
      FROM public.sales
      WHERE customer_id = v_pay.customer_id AND status = 'completed' AND amount_paid > 0
      ORDER BY created_at DESC FOR UPDATE
    LOOP
      EXIT WHEN v_remaining <= 0;
      v_take := LEAST(v_si.amount_paid, v_remaining);
      -- Only restore portions that originated from debt repayments (best-effort)
      UPDATE public.sales
        SET amount_paid = amount_paid - v_take,
            remaining_debt = remaining_debt + v_take
        WHERE id = v_si.id;
      v_remaining := v_remaining - v_take;
    END LOOP;
  END IF;

  DELETE FROM public.payments WHERE id = _payment_id;
END;
$function$;
