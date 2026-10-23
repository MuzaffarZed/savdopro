-- Pricelist settings (single row per workspace) and per-product overrides stored in DB so prices persist across devices.

CREATE TABLE IF NOT EXISTS public.pricelist_settings (
  id BOOLEAN PRIMARY KEY DEFAULT TRUE,
  default_markup NUMERIC NOT NULL DEFAULT 30,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID,
  CONSTRAINT singleton CHECK (id = TRUE)
);

INSERT INTO public.pricelist_settings (id, default_markup) VALUES (TRUE, 30)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.pricelist_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "All view pricelist settings"
ON public.pricelist_settings FOR SELECT
TO authenticated USING (true);

CREATE POLICY "Super admin updates pricelist settings"
ON public.pricelist_settings FOR UPDATE
TO authenticated USING (is_super_admin()) WITH CHECK (is_super_admin());

CREATE POLICY "Super admin inserts pricelist settings"
ON public.pricelist_settings FOR INSERT
TO authenticated WITH CHECK (is_super_admin());

CREATE TABLE IF NOT EXISTS public.pricelist_overrides (
  product_id UUID PRIMARY KEY,
  markup NUMERIC,
  price NUMERIC,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID
);

ALTER TABLE public.pricelist_overrides ENABLE ROW LEVEL SECURITY;

CREATE POLICY "All view pricelist overrides"
ON public.pricelist_overrides FOR SELECT
TO authenticated USING (true);

CREATE POLICY "Super admin manages pricelist overrides"
ON public.pricelist_overrides FOR ALL
TO authenticated USING (is_super_admin()) WITH CHECK (is_super_admin());
