CREATE OR REPLACE FUNCTION public.update_transfer_items(_transfer_id uuid, _items jsonb, _note text, _user_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_transfer RECORD;
  v_item RECORD;
  v_dest RECORD;
  v_jitem jsonb;
  v_product_id uuid;
  v_quantity numeric;
  v_required numeric;
  v_used numeric;
  v_total_qty numeric := 0;
  v_total_cost numeric := 0;
  v_dest_batch_id uuid;
  v_batch RECORD;
  v_snapshot jsonb;
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Faqat super-admin transferni tahrirlay oladi';
  END IF;
  IF jsonb_array_length(_items) = 0 THEN RAISE EXCEPTION 'Mahsulotlar bo''sh'; END IF;

  SELECT * INTO v_transfer FROM public.transfers WHERE id = _transfer_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Transfer topilmadi'; END IF;

  -- Snapshot for audit
  SELECT jsonb_build_object(
    'transfer', to_jsonb(t.*),
    'items', COALESCE((SELECT jsonb_agg(to_jsonb(ti.*)) FROM public.transfer_items ti WHERE ti.transfer_id = t.id), '[]'::jsonb)
  )
  INTO v_snapshot
  FROM public.transfers t WHERE t.id = _transfer_id;

  -- Validate: every dest_batch must be fully intact
  FOR v_item IN
    SELECT ti.dest_batch_id FROM public.transfer_items ti WHERE ti.transfer_id = _transfer_id
  LOOP
    SELECT * INTO v_dest FROM public.inventory_batches WHERE id = v_item.dest_batch_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Manzil partiya topilmadi'; END IF;
    IF v_dest.remaining <> v_dest.quantity THEN
      RAISE EXCEPTION 'Bu transferdan mahsulot sotilgan/ko''chirilgan — tahrirlab bo''lmaydi';
    END IF;
  END LOOP;

  -- Reverse: restore source, delete dest batches + movements + items
  FOR v_item IN
    SELECT ti.dest_batch_id, ti.source_batch_id, ti.quantity
    FROM public.transfer_items ti WHERE ti.transfer_id = _transfer_id
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

  -- Re-process items with FIFO (same logic as process_transfer)
  FOR v_jitem IN SELECT * FROM jsonb_array_elements(_items) LOOP
    v_product_id := (v_jitem->>'product_id')::uuid;
    v_quantity := (v_jitem->>'quantity')::numeric;
    IF v_quantity <= 0 THEN RAISE EXCEPTION 'Miqdor musbat bo''lishi kerak'; END IF;
    v_required := v_quantity;

    FOR v_batch IN
      SELECT id, remaining, cost_price FROM public.inventory_batches
      WHERE product_id = v_product_id AND warehouse_id = v_transfer.from_warehouse_id AND remaining > 0
      ORDER BY created_at ASC FOR UPDATE
    LOOP
      EXIT WHEN v_required <= 0;
      v_used := LEAST(v_batch.remaining, v_required);

      UPDATE public.inventory_batches SET remaining = remaining - v_used WHERE id = v_batch.id;

      INSERT INTO public.inventory_batches (product_id, warehouse_id, quantity, remaining, cost_price, source_batch_id)
      VALUES (v_product_id, v_transfer.to_warehouse_id, v_used, v_used, v_batch.cost_price, v_batch.id)
      RETURNING id INTO v_dest_batch_id;

      INSERT INTO public.transfer_items (transfer_id, product_id, source_batch_id, dest_batch_id, quantity, cost_price)
      VALUES (_transfer_id, v_product_id, v_batch.id, v_dest_batch_id, v_used, v_batch.cost_price);

      INSERT INTO public.inventory_movements (type, product_id, warehouse_id, batch_id, quantity, cost_price, ref_type, ref_id, created_by)
      VALUES ('transfer_out', v_product_id, v_transfer.from_warehouse_id, v_batch.id, -v_used, v_batch.cost_price, 'transfer', _transfer_id, _user_id);

      INSERT INTO public.inventory_movements (type, product_id, warehouse_id, batch_id, quantity, cost_price, ref_type, ref_id, created_by)
      VALUES ('transfer_in', v_product_id, v_transfer.to_warehouse_id, v_dest_batch_id, v_used, v_batch.cost_price, 'transfer', _transfer_id, _user_id);

      v_total_qty := v_total_qty + v_used;
      v_total_cost := v_total_cost + v_used * v_batch.cost_price;
      v_required := v_required - v_used;
    END LOOP;

    IF v_required > 0 THEN
      RAISE EXCEPTION 'Manba sklatda qoldiq yetarli emas. Yetishmagan: %', v_required;
    END IF;
  END LOOP;

  UPDATE public.transfers
    SET total_quantity = v_total_qty,
        total_cost = v_total_cost,
        note = _note
    WHERE id = _transfer_id;

  INSERT INTO public.transfer_audit_log (transfer_id, action, actor_id, snapshot)
  VALUES (_transfer_id, 'update_items', _user_id, v_snapshot);
END;
$function$;