-- Update purchase: only allowed if related FIFO batch is fully untouched (remaining = quantity)
CREATE OR REPLACE FUNCTION public.update_purchase(
  _purchase_id uuid,
  _quantity numeric,
  _cost_price numeric,
  _note text,
  _user_id uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_purchase RECORD;
  v_batch RECORD;
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Faqat super-admin xaridni tahrirlay oladi';
  END IF;
  IF _quantity <= 0 THEN RAISE EXCEPTION 'Miqdor musbat bo''lishi kerak'; END IF;
  IF _cost_price < 0 THEN RAISE EXCEPTION 'Tannarx manfiy bo''lmaydi'; END IF;

  SELECT * INTO v_purchase FROM public.purchases WHERE id = _purchase_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Xarid topilmadi'; END IF;

  -- Locate the FIFO batch created by this purchase via inventory_movements
  SELECT b.* INTO v_batch
  FROM public.inventory_batches b
  JOIN public.inventory_movements m ON m.batch_id = b.id
  WHERE m.ref_type = 'purchase' AND m.ref_id = _purchase_id AND m.type = 'purchase'
  LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'Bog''langan partiya topilmadi'; END IF;

  IF v_batch.remaining <> v_batch.quantity THEN
    RAISE EXCEPTION 'Bu xariddan mahsulot sotilgan/ko''chirilgan — o''zgartirib bo''lmaydi';
  END IF;

  -- Update batch
  UPDATE public.inventory_batches
    SET quantity = _quantity, remaining = _quantity, cost_price = _cost_price
    WHERE id = v_batch.id;

  -- Update movement
  UPDATE public.inventory_movements
    SET quantity = _quantity, cost_price = _cost_price
    WHERE ref_type = 'purchase' AND ref_id = _purchase_id AND type = 'purchase';

  -- Update purchase
  UPDATE public.purchases
    SET quantity = _quantity, cost_price = _cost_price,
        total_cost = _quantity * _cost_price, note = _note
    WHERE id = _purchase_id;
END;
$$;

-- Delete purchase: only if batch fully untouched
CREATE OR REPLACE FUNCTION public.delete_purchase(
  _purchase_id uuid,
  _user_id uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_batch RECORD;
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Faqat super-admin xaridni o''chira oladi';
  END IF;

  SELECT b.* INTO v_batch
  FROM public.inventory_batches b
  JOIN public.inventory_movements m ON m.batch_id = b.id
  WHERE m.ref_type = 'purchase' AND m.ref_id = _purchase_id AND m.type = 'purchase'
  LIMIT 1;

  IF FOUND THEN
    IF v_batch.remaining <> v_batch.quantity THEN
      RAISE EXCEPTION 'Bu xariddan mahsulot sotilgan/ko''chirilgan — o''chirib bo''lmaydi';
    END IF;
    DELETE FROM public.inventory_movements WHERE batch_id = v_batch.id;
    DELETE FROM public.inventory_batches WHERE id = v_batch.id;
  END IF;

  DELETE FROM public.inventory_movements WHERE ref_type = 'purchase' AND ref_id = _purchase_id;
  DELETE FROM public.purchases WHERE id = _purchase_id;
END;
$$;