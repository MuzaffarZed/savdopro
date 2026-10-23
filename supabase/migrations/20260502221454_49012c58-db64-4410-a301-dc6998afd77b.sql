
CREATE OR REPLACE FUNCTION public.update_sale_items(
  _sale_id uuid,
  _items jsonb,
  _user_id uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_sale RECORD;
  v_mov RECORD;
  v_item jsonb;
  v_product_id uuid;
  v_quantity numeric;
  v_sell_price numeric;
  v_required numeric;
  v_used numeric;
  v_item_cost numeric;
  v_item_total numeric;
  v_total_sale numeric := 0;
  v_total_cost numeric := 0;
  v_sale_item_id uuid;
  v_batch RECORD;
  v_old_debt numeric;
  v_new_debt numeric;
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Faqat super-admin tahrirlay oladi';
  END IF;

  IF jsonb_array_length(_items) = 0 THEN RAISE EXCEPTION 'Mahsulotlar bo''sh'; END IF;

  SELECT * INTO v_sale FROM public.sales WHERE id = _sale_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Sotuv topilmadi'; END IF;
  IF v_sale.status <> 'completed' THEN RAISE EXCEPTION 'Faqat completed sotuvni tahrirlash mumkin'; END IF;

  v_old_debt := v_sale.remaining_debt;

  -- 1) Restore inventory from current sale items
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

  -- 2) Remove old movements + items
  DELETE FROM public.inventory_movements
    WHERE ref_type = 'sale_item'
      AND ref_id IN (SELECT id FROM public.sale_items WHERE sale_id = _sale_id);
  DELETE FROM public.sale_items WHERE sale_id = _sale_id;

  -- 3) Re-process new items with FIFO
  FOR v_item IN SELECT * FROM jsonb_array_elements(_items)
  LOOP
    v_product_id := (v_item->>'product_id')::uuid;
    v_quantity := (v_item->>'quantity')::numeric;
    v_sell_price := (v_item->>'sell_price')::numeric;

    IF v_quantity <= 0 THEN RAISE EXCEPTION 'Miqdor musbat bo''lishi kerak'; END IF;
    IF v_sell_price < 0 THEN RAISE EXCEPTION 'Narx manfiy bo''lmaydi'; END IF;

    v_item_total := v_quantity * v_sell_price;
    v_item_cost := 0;
    v_required := v_quantity;

    INSERT INTO public.sale_items (sale_id, product_id, quantity, sell_price, total_price)
    VALUES (_sale_id, v_product_id, v_quantity, v_sell_price, v_item_total)
    RETURNING id INTO v_sale_item_id;

    FOR v_batch IN
      SELECT id, remaining, cost_price FROM public.inventory_batches
      WHERE product_id = v_product_id AND warehouse_id = v_sale.warehouse_id AND remaining > 0
      ORDER BY created_at ASC FOR UPDATE
    LOOP
      EXIT WHEN v_required <= 0;
      v_used := LEAST(v_batch.remaining, v_required);
      UPDATE public.inventory_batches SET remaining = remaining - v_used WHERE id = v_batch.id;

      INSERT INTO public.inventory_movements (type, product_id, warehouse_id, batch_id, quantity, cost_price, ref_type, ref_id, created_by)
      VALUES ('sale', v_product_id, v_sale.warehouse_id, v_batch.id, -v_used, v_batch.cost_price, 'sale_item', v_sale_item_id, _user_id);

      v_item_cost := v_item_cost + (v_used * v_batch.cost_price);
      v_required := v_required - v_used;
    END LOOP;

    IF v_required > 0 THEN
      RAISE EXCEPTION 'Qoldiq yetarli emas. Yetishmagan: %', v_required;
    END IF;

    UPDATE public.sale_items SET total_cost = v_item_cost WHERE id = v_sale_item_id;
    v_total_sale := v_total_sale + v_item_total;
    v_total_cost := v_total_cost + v_item_cost;
  END LOOP;

  v_new_debt := GREATEST(v_total_sale - v_sale.amount_paid, 0);

  UPDATE public.sales SET
    total_sale = v_total_sale,
    total_cost = v_total_cost,
    profit = v_total_sale - v_total_cost,
    remaining_debt = v_new_debt
  WHERE id = _sale_id;

  -- 4) Adjust customer balance by delta of remaining_debt
  IF v_sale.customer_id IS NOT NULL THEN
    UPDATE public.customers
      SET balance = balance + (v_new_debt - v_old_debt)
      WHERE id = v_sale.customer_id;
  END IF;
END;
$function$;
