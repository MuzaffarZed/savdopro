ALTER TABLE public.branches DROP COLUMN IF EXISTS latitude;
ALTER TABLE public.branches DROP COLUMN IF EXISTS longitude;
ALTER TABLE public.branches DROP COLUMN IF EXISTS image_url;

ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS latitude numeric;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS longitude numeric;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS image_url text;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS address text;

DROP POLICY IF EXISTS "Branch images public read" ON storage.objects;
DROP POLICY IF EXISTS "Super admin upload branch images" ON storage.objects;
DROP POLICY IF EXISTS "Super admin update branch images" ON storage.objects;
DROP POLICY IF EXISTS "Super admin delete branch images" ON storage.objects;

INSERT INTO storage.buckets (id, name, public) VALUES ('customer-images', 'customer-images', true) ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Customer images public read" ON storage.objects
FOR SELECT USING (bucket_id = 'customer-images');

CREATE POLICY "Authenticated upload customer images" ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'customer-images');

CREATE POLICY "Authenticated update customer images" ON storage.objects
FOR UPDATE TO authenticated
USING (bucket_id = 'customer-images');

CREATE POLICY "Authenticated delete customer images" ON storage.objects
FOR DELETE TO authenticated
USING (bucket_id = 'customer-images');
