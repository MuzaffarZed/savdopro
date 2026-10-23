
-- 1) Add FKs (so PostgREST embed works)
ALTER TABLE public.damages
  ADD CONSTRAINT damages_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id),
  ADD CONSTRAINT damages_warehouse_id_fkey FOREIGN KEY (warehouse_id) REFERENCES public.warehouses(id);

-- 2) delete_damage: restore inventory then remove
CREATE OR REPLACE FUNCTION public.delete_damage(_damage_id uuid, _user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_mov RECORD;
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Faqat super-admin brakni o''chira oladi';
  END IF;

  -- Restore each batch this damage took from
  FOR v_mov IN
    SELECT batch_id, quantity FROM public.inventory_movements
    WHERE ref_type = 'damage' AND ref_id = _damage_id AND type = 'damage'
  LOOP
    UPDATE public.inventory_batches
      SET remaining = remaining + ABS(v_mov.quantity)
      WHERE id = v_mov.batch_id;
  END LOOP;

  DELETE FROM public.inventory_movements WHERE ref_type = 'damage' AND ref_id = _damage_id;
  DELETE FROM public.damages WHERE id = _damage_id;
END;
$$;

-- 3) update_damage: revert old, apply new (restore + re-FIFO)
CREATE OR REPLACE FUNCTION public.update_damage(_damage_id uuid, _quantity numeric, _reason text, _note text, _user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_d RECORD;
  v_mov RECORD;
  v_required NUMERIC;
  v_used NUMERIC;
  v_total_cost NUMERIC := 0;
  v_batch RECORD;
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Faqat super-admin brakni tahrirlay oladi';
  END IF;
  IF _quantity <= 0 THEN RAISE EXCEPTION 'Miqdor musbat bo''lishi kerak'; END IF;

  SELECT * INTO v_d FROM public.damages WHERE id = _damage_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Brak topilmadi'; END IF;

  -- Revert old movements
  FOR v_mov IN
    SELECT batch_id, quantity FROM public.inventory_movements
    WHERE ref_type = 'damage' AND ref_id = _damage_id AND type = 'damage'
  LOOP
    UPDATE public.inventory_batches
      SET remaining = remaining + ABS(v_mov.quantity)
      WHERE id = v_mov.batch_id;
  END LOOP;
  DELETE FROM public.inventory_movements WHERE ref_type = 'damage' AND ref_id = _damage_id;

  -- Re-apply with new quantity (FIFO)
  v_required := _quantity;
  FOR v_batch IN
    SELECT id, remaining, cost_price FROM public.inventory_batches
    WHERE product_id = v_d.product_id AND warehouse_id = v_d.warehouse_id AND remaining > 0
    ORDER BY created_at ASC FOR UPDATE
  LOOP
    EXIT WHEN v_required <= 0;
    v_used := LEAST(v_batch.remaining, v_required);
    UPDATE public.inventory_batches SET remaining = remaining - v_used WHERE id = v_batch.id;

    INSERT INTO public.inventory_movements
      (type, product_id, warehouse_id, batch_id, quantity, cost_price, ref_type, ref_id, created_by)
    VALUES
      ('damage', v_d.product_id, v_d.warehouse_id, v_batch.id, -v_used, v_batch.cost_price, 'damage', _damage_id, _user_id);

    v_total_cost := v_total_cost + v_used * v_batch.cost_price;
    v_required := v_required - v_used;
  END LOOP;

  IF v_required > 0 THEN
    RAISE EXCEPTION 'Qoldiq yetarli emas. Yetishmagan: %', v_required;
  END IF;

  UPDATE public.damages
    SET quantity = _quantity, reason = _reason, note = _note, total_cost = v_total_cost
    WHERE id = _damage_id;
END;
$$;
