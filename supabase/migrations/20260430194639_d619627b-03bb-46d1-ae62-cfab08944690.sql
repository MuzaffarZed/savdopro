-- Super admin: delete transfer (only if destination batches untouched)
CREATE OR REPLACE FUNCTION public.delete_transfer(_transfer_id uuid, _user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item RECORD;
  v_dest RECORD;
  v_src RECORD;
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Faqat super-admin transferni o''chira oladi';
  END IF;

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
    -- Restore source batch remaining (if source still exists)
    UPDATE public.inventory_batches
      SET remaining = remaining + v_item.quantity
      WHERE id = v_item.source_batch_id;

    -- Delete movements for this dest batch
    DELETE FROM public.inventory_movements WHERE batch_id = v_item.dest_batch_id;
    -- Delete movements for source batch tied to this transfer
    DELETE FROM public.inventory_movements
      WHERE ref_type = 'transfer' AND ref_id = _transfer_id AND batch_id = v_item.source_batch_id;

    -- Delete dest batch
    DELETE FROM public.inventory_batches WHERE id = v_item.dest_batch_id;
  END LOOP;

  -- Cleanup remaining movements & items
  DELETE FROM public.inventory_movements WHERE ref_type = 'transfer' AND ref_id = _transfer_id;
  DELETE FROM public.transfer_items WHERE transfer_id = _transfer_id;
  DELETE FROM public.transfers WHERE id = _transfer_id;
END;
$$;

-- Super admin: update transfer note only (safe edit)
CREATE OR REPLACE FUNCTION public.update_transfer_note(_transfer_id uuid, _note text, _user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Faqat super-admin tahrirlay oladi';
  END IF;
  UPDATE public.transfers SET note = _note WHERE id = _transfer_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Transfer topilmadi'; END IF;
END;
$$;