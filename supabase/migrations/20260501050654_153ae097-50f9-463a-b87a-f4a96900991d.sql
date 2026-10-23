DO $$
BEGIN
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.shifts; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.pricelist_settings; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.pricelist_overrides; EXCEPTION WHEN duplicate_object THEN NULL; END;
END $$;

ALTER TABLE public.shifts REPLICA IDENTITY FULL;
ALTER TABLE public.pricelist_settings REPLICA IDENTITY FULL;
ALTER TABLE public.pricelist_overrides REPLICA IDENTITY FULL;