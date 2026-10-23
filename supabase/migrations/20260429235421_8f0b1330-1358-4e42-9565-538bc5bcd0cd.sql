-- Transfers
CREATE TABLE public.transfers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_warehouse_id UUID NOT NULL,
  to_warehouse_id UUID NOT NULL,
  note TEXT,
  status TEXT NOT NULL DEFAULT 'completed',
  total_quantity NUMERIC NOT NULL DEFAULT 0,
  total_cost NUMERIC NOT NULL DEFAULT 0,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.transfer_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transfer_id UUID NOT NULL REFERENCES public.transfers(id) ON DELETE CASCADE,
  product_id UUID NOT NULL,
  source_batch_id UUID NOT NULL,
  dest_batch_id UUID NOT NULL,
  quantity NUMERIC NOT NULL,
  cost_price NUMERIC NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.transfers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transfer_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "View transfers in scope" ON public.transfers FOR SELECT TO authenticated
USING (
  is_super_admin() OR
  from_warehouse_id IN (SELECT id FROM public.warehouses WHERE branch_id = get_user_branch(auth.uid()) OR type = 'main') OR
  to_warehouse_id IN (SELECT id FROM public.warehouses WHERE branch_id = get_user_branch(auth.uid()))
);

CREATE POLICY "View transfer items in scope" ON public.transfer_items FOR SELECT TO authenticated
USING (transfer_id IN (SELECT id FROM public.transfers));

-- Add 'transfer_in' / 'transfer_out' to inventory_movements type enum if not present
DO $$ BEGIN
  ALTER TYPE movement_type ADD VALUE IF NOT EXISTS 'transfer_out';
EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN
  ALTER TYPE movement_type ADD VALUE IF NOT EXISTS 'transfer_in';
EXCEPTION WHEN others THEN NULL; END $$;

-- Process transfer function (FIFO from source, create new batches in dest preserving cost)
CREATE OR REPLACE FUNCTION public.process_transfer(
  _from_warehouse_id UUID,
  _to_warehouse_id UUID,
  _items JSONB,
  _note TEXT,
  _user_id UUID,
  _idempotency_key TEXT
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_existing UUID;
  v_transfer_id UUID;
  v_item JSONB;
  v_product_id UUID;
  v_quantity NUMERIC;
  v_required NUMERIC;
  v_used NUMERIC;
  v_total_qty NUMERIC := 0;
  v_total_cost NUMERIC := 0;
  v_dest_batch_id UUID;
  v_batch RECORD;
BEGIN
  IF _idempotency_key IS NOT NULL THEN
    SELECT result_id INTO v_existing FROM public.idempotency_keys WHERE key = _idempotency_key;
    IF FOUND THEN RETURN v_existing; END IF;
  END IF;

  IF _from_warehouse_id = _to_warehouse_id THEN RAISE EXCEPTION 'Source and destination must differ'; END IF;
  IF jsonb_array_length(_items) = 0 THEN RAISE EXCEPTION 'No items'; END IF;

  INSERT INTO public.transfers (from_warehouse_id, to_warehouse_id, note, created_by)
  VALUES (_from_warehouse_id, _to_warehouse_id, _note, _user_id)
  RETURNING id INTO v_transfer_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(_items) LOOP
    v_product_id := (v_item->>'product_id')::UUID;
    v_quantity := (v_item->>'quantity')::NUMERIC;
    IF v_quantity <= 0 THEN RAISE EXCEPTION 'Quantity must be > 0'; END IF;
    v_required := v_quantity;

    FOR v_batch IN
      SELECT id, remaining, cost_price FROM public.inventory_batches
      WHERE product_id = v_product_id AND warehouse_id = _from_warehouse_id AND remaining > 0
      ORDER BY created_at ASC FOR UPDATE
    LOOP
      EXIT WHEN v_required <= 0;
      v_used := LEAST(v_batch.remaining, v_required);

      UPDATE public.inventory_batches SET remaining = remaining - v_used WHERE id = v_batch.id;

      -- Create dest batch with same cost
      INSERT INTO public.inventory_batches (product_id, warehouse_id, quantity, remaining, cost_price, source_batch_id)
      VALUES (v_product_id, _to_warehouse_id, v_used, v_used, v_batch.cost_price, v_batch.id)
      RETURNING id INTO v_dest_batch_id;

      INSERT INTO public.transfer_items (transfer_id, product_id, source_batch_id, dest_batch_id, quantity, cost_price)
      VALUES (v_transfer_id, v_product_id, v_batch.id, v_dest_batch_id, v_used, v_batch.cost_price);

      INSERT INTO public.inventory_movements (type, product_id, warehouse_id, batch_id, quantity, cost_price, ref_type, ref_id, created_by)
      VALUES ('transfer_out', v_product_id, _from_warehouse_id, v_batch.id, -v_used, v_batch.cost_price, 'transfer', v_transfer_id, _user_id);

      INSERT INTO public.inventory_movements (type, product_id, warehouse_id, batch_id, quantity, cost_price, ref_type, ref_id, created_by)
      VALUES ('transfer_in', v_product_id, _to_warehouse_id, v_dest_batch_id, v_used, v_batch.cost_price, 'transfer', v_transfer_id, _user_id);

      v_total_qty := v_total_qty + v_used;
      v_total_cost := v_total_cost + v_used * v_batch.cost_price;
      v_required := v_required - v_used;
    END LOOP;

    IF v_required > 0 THEN
      RAISE EXCEPTION 'Insufficient stock for product % in source warehouse. Missing %', v_product_id, v_required;
    END IF;
  END LOOP;

  UPDATE public.transfers SET total_quantity = v_total_qty, total_cost = v_total_cost WHERE id = v_transfer_id;

  IF _idempotency_key IS NOT NULL THEN
    INSERT INTO public.idempotency_keys (key, user_id, result_id) VALUES (_idempotency_key, _user_id, v_transfer_id);
  END IF;

  RETURN v_transfer_id;
END $$;

-- Realtime
ALTER TABLE public.sales REPLICA IDENTITY FULL;
ALTER TABLE public.inventory_batches REPLICA IDENTITY FULL;
ALTER TABLE public.inventory_movements REPLICA IDENTITY FULL;
ALTER TABLE public.transfers REPLICA IDENTITY FULL;
ALTER TABLE public.customers REPLICA IDENTITY FULL;
ALTER TABLE public.payments REPLICA IDENTITY FULL;

ALTER PUBLICATION supabase_realtime ADD TABLE public.sales;
ALTER PUBLICATION supabase_realtime ADD TABLE public.inventory_batches;
ALTER PUBLICATION supabase_realtime ADD TABLE public.inventory_movements;
ALTER PUBLICATION supabase_realtime ADD TABLE public.transfers;
ALTER PUBLICATION supabase_realtime ADD TABLE public.customers;
ALTER PUBLICATION supabase_realtime ADD TABLE public.payments;