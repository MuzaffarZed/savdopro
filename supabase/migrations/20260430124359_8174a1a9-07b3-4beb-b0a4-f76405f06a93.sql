-- Brak (damage) jadvali
CREATE TABLE public.damages (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  product_id UUID NOT NULL,
  warehouse_id UUID NOT NULL,
  quantity NUMERIC NOT NULL,
  total_cost NUMERIC NOT NULL DEFAULT 0,
  reason TEXT NOT NULL,
  note TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.damages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "View damages in scope"
ON public.damages FOR SELECT
TO authenticated
USING (
  is_super_admin() OR warehouse_id IN (
    SELECT id FROM public.warehouses
    WHERE branch_id = get_user_branch(auth.uid()) OR type = 'main'
  )
);

CREATE POLICY "Super admin deletes damages"
ON public.damages FOR DELETE
TO authenticated
USING (is_super_admin());

-- RPC: brak qilish (FIFO bo'yicha remaining'dan ayirish)
CREATE OR REPLACE FUNCTION public.process_damage(
  _product_id UUID,
  _warehouse_id UUID,
  _quantity NUMERIC,
  _reason TEXT,
  _note TEXT,
  _user_id UUID,
  _idempotency_key TEXT
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing UUID;
  v_damage_id UUID;
  v_required NUMERIC;
  v_used NUMERIC;
  v_total_cost NUMERIC := 0;
  v_batch RECORD;
  v_allowed BOOLEAN;
BEGIN
  IF _idempotency_key IS NOT NULL THEN
    SELECT result_id INTO v_existing FROM public.idempotency_keys WHERE key = _idempotency_key;
    IF FOUND THEN RETURN v_existing; END IF;
  END IF;

  IF _quantity <= 0 THEN RAISE EXCEPTION 'Miqdor musbat bo''lishi kerak'; END IF;
  IF _reason IS NULL OR length(trim(_reason)) = 0 THEN RAISE EXCEPTION 'Sabab kiritilishi shart'; END IF;

  -- Skladga ruxsat tekshiruvi: super_admin yoki o'z filiali yoki main sklad (sotuvchi ham main'dan brak qila olmasin)
  SELECT (
    public.is_super_admin() OR EXISTS (
      SELECT 1 FROM public.warehouses w
      WHERE w.id = _warehouse_id AND w.branch_id = public.get_user_branch(_user_id)
    )
  ) INTO v_allowed;
  IF NOT v_allowed THEN RAISE EXCEPTION 'Bu sklatga ruxsat yo''q'; END IF;

  v_required := _quantity;

  INSERT INTO public.damages (product_id, warehouse_id, quantity, reason, note, created_by, total_cost)
  VALUES (_product_id, _warehouse_id, _quantity, _reason, _note, _user_id, 0)
  RETURNING id INTO v_damage_id;

  FOR v_batch IN
    SELECT id, remaining, cost_price FROM public.inventory_batches
    WHERE product_id = _product_id AND warehouse_id = _warehouse_id AND remaining > 0
    ORDER BY created_at ASC FOR UPDATE
  LOOP
    EXIT WHEN v_required <= 0;
    v_used := LEAST(v_batch.remaining, v_required);
    UPDATE public.inventory_batches SET remaining = remaining - v_used WHERE id = v_batch.id;

    INSERT INTO public.inventory_movements
      (type, product_id, warehouse_id, batch_id, quantity, cost_price, ref_type, ref_id, created_by)
    VALUES
      ('damage', _product_id, _warehouse_id, v_batch.id, -v_used, v_batch.cost_price, 'damage', v_damage_id, _user_id);

    v_total_cost := v_total_cost + v_used * v_batch.cost_price;
    v_required := v_required - v_used;
  END LOOP;

  IF v_required > 0 THEN
    RAISE EXCEPTION 'Qoldiq yetarli emas. Yetishmagan: %', v_required;
  END IF;

  UPDATE public.damages SET total_cost = v_total_cost WHERE id = v_damage_id;

  IF _idempotency_key IS NOT NULL THEN
    INSERT INTO public.idempotency_keys (key, user_id, result_id) VALUES (_idempotency_key, _user_id, v_damage_id);
  END IF;

  RETURN v_damage_id;
END;
$$;

-- inventory_movements.type enum'ga 'damage' qo'shish (agar yo'q bo'lsa)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'movement_type' AND e.enumlabel = 'damage'
  ) THEN
    ALTER TYPE movement_type ADD VALUE 'damage';
  END IF;
END $$;