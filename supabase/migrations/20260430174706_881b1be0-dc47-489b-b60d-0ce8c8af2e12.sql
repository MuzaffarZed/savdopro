-- Realtime publicationga ombor consistency uchun kerakli jadvallarni qo'shamiz
ALTER PUBLICATION supabase_realtime ADD TABLE public.damages;
ALTER PUBLICATION supabase_realtime ADD TABLE public.purchases;
ALTER PUBLICATION supabase_realtime ADD TABLE public.sale_items;
ALTER PUBLICATION supabase_realtime ADD TABLE public.transfer_items;

-- Inventory batches va movements uchun REPLICA IDENTITY FULL — to'liq payload realtime'da
ALTER TABLE public.inventory_batches REPLICA IDENTITY FULL;
ALTER TABLE public.inventory_movements REPLICA IDENTITY FULL;
ALTER TABLE public.damages REPLICA IDENTITY FULL;
ALTER TABLE public.purchases REPLICA IDENTITY FULL;

-- Sklad qoldiqlari hech qachon manfiy bo'lmasligi uchun strict cheklov
-- (Hozirgi RPC'lar buni allaqachon ta'minlaydi, lekin database-level guard qo'shamiz)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'inventory_batches_remaining_nonneg'
  ) THEN
    ALTER TABLE public.inventory_batches
      ADD CONSTRAINT inventory_batches_remaining_nonneg
      CHECK (remaining >= 0 AND remaining <= quantity);
  END IF;
END $$;

-- Tezroq qidiruv uchun indekslar (FIFO sklad bo'yicha tartiblanadi)
CREATE INDEX IF NOT EXISTS idx_batches_wh_prod_remaining
  ON public.inventory_batches (warehouse_id, product_id, created_at)
  WHERE remaining > 0;

CREATE INDEX IF NOT EXISTS idx_movements_wh_created
  ON public.inventory_movements (warehouse_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_sales_branch_created
  ON public.sales (branch_id, created_at DESC)
  WHERE status = 'completed';

CREATE INDEX IF NOT EXISTS idx_transfers_from_created
  ON public.transfers (from_warehouse_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_transfers_to_created
  ON public.transfers (to_warehouse_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_transfer_items_transfer_product
  ON public.transfer_items (transfer_id, product_id);

-- Sklad qoldiqlarini auditlash uchun yordamchi view
-- (Movements'dan yig'ilgan haqiqiy qoldiq vs inventory_batches.remaining mos kelishini ko'rsatadi)
CREATE OR REPLACE VIEW public.inventory_audit
WITH (security_invoker=on) AS
SELECT
  b.warehouse_id,
  b.product_id,
  SUM(b.remaining)::numeric AS batch_remaining,
  COALESCE((
    SELECT SUM(m.quantity)
    FROM public.inventory_movements m
    WHERE m.warehouse_id = b.warehouse_id AND m.product_id = b.product_id
  ), 0)::numeric AS movement_balance
FROM public.inventory_batches b
GROUP BY b.warehouse_id, b.product_id;