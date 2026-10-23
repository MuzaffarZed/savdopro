ALTER TABLE public.branches
  ADD COLUMN IF NOT EXISTS latitude numeric,
  ADD COLUMN IF NOT EXISTS longitude numeric,
  ADD COLUMN IF NOT EXISTS image_url text;

INSERT INTO storage.buckets (id, name, public)
VALUES ('branch-images', 'branch-images', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Public read branch images" ON storage.objects;
CREATE POLICY "Public read branch images"
ON storage.objects FOR SELECT
USING (bucket_id = 'branch-images');

DROP POLICY IF EXISTS "Super admin upload branch images" ON storage.objects;
CREATE POLICY "Super admin upload branch images"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'branch-images' AND public.is_super_admin());

DROP POLICY IF EXISTS "Super admin update branch images" ON storage.objects;
CREATE POLICY "Super admin update branch images"
ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'branch-images' AND public.is_super_admin());

DROP POLICY IF EXISTS "Super admin delete branch images" ON storage.objects;
CREATE POLICY "Super admin delete branch images"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'branch-images' AND public.is_super_admin());