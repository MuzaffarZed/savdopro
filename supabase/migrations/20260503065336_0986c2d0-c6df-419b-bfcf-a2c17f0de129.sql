
CREATE TABLE IF NOT EXISTS public.audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  table_name text NOT NULL,
  record_id uuid,
  action text NOT NULL CHECK (action IN ('UPDATE','DELETE','INSERT')),
  actor_id uuid,
  changed_at timestamptz NOT NULL DEFAULT now(),
  old_data jsonb,
  new_data jsonb,
  changed_fields text[]
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_table_record ON public.audit_logs(table_name, record_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor ON public.audit_logs(actor_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_changed_at ON public.audit_logs(changed_at DESC);

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Super admin views audit logs"
  ON public.audit_logs FOR SELECT
  TO authenticated
  USING (public.is_super_admin());

-- Generic trigger function
CREATE OR REPLACE FUNCTION public.log_audit_event()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid;
  v_old jsonb;
  v_new jsonb;
  v_changed text[];
  v_record_id uuid;
  v_key text;
BEGIN
  v_actor := auth.uid();

  IF TG_OP = 'DELETE' THEN
    v_old := to_jsonb(OLD);
    v_new := NULL;
    BEGIN v_record_id := (v_old->>'id')::uuid; EXCEPTION WHEN OTHERS THEN v_record_id := NULL; END;
  ELSIF TG_OP = 'UPDATE' THEN
    v_old := to_jsonb(OLD);
    v_new := to_jsonb(NEW);
    BEGIN v_record_id := (v_new->>'id')::uuid; EXCEPTION WHEN OTHERS THEN v_record_id := NULL; END;
    -- Compute changed field names
    SELECT array_agg(k) INTO v_changed
    FROM (
      SELECT key AS k FROM jsonb_each(v_new)
      WHERE v_new->key IS DISTINCT FROM v_old->key
    ) s;
    -- Skip if nothing actually changed (e.g. only updated_at)
    IF v_changed IS NULL OR array_length(v_changed,1) IS NULL THEN
      RETURN NEW;
    END IF;
  ELSE
    v_old := NULL;
    v_new := to_jsonb(NEW);
    BEGIN v_record_id := (v_new->>'id')::uuid; EXCEPTION WHEN OTHERS THEN v_record_id := NULL; END;
  END IF;

  INSERT INTO public.audit_logs (table_name, record_id, action, actor_id, old_data, new_data, changed_fields)
  VALUES (TG_TABLE_NAME, v_record_id, TG_OP, v_actor, v_old, v_new, v_changed);

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

-- Attach triggers (UPDATE + DELETE) on business tables
DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'customers','products','sales','sale_items','payments','purchases',
    'damages','transfers','transfer_items','inventory_batches','warehouses',
    'branches','pricelist_overrides','pricelist_settings','shifts',
    'user_roles','profiles'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS audit_%1$s_trg ON public.%1$I', t);
    EXECUTE format(
      'CREATE TRIGGER audit_%1$s_trg
       AFTER UPDATE OR DELETE ON public.%1$I
       FOR EACH ROW EXECUTE FUNCTION public.log_audit_event()',
      t
    );
  END LOOP;
END $$;
