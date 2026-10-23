CREATE OR REPLACE FUNCTION public.delete_shift(_shift_id uuid, _user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_admin boolean;
BEGIN
  SELECT public.has_role(_user_id, 'super_admin'::app_role) INTO v_is_admin;
  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'Faqat super-admin smenani o''chira oladi';
  END IF;

  -- Detach linked sales/payments so history remains intact
  UPDATE public.sales SET shift_id = NULL WHERE shift_id = _shift_id;
  UPDATE public.payments SET shift_id = NULL WHERE shift_id = _shift_id;

  INSERT INTO public.audit_logs(table_name, record_id, action, actor_id, old_data)
  SELECT 'shifts', id, 'delete', _user_id, to_jsonb(s.*) FROM public.shifts s WHERE id = _shift_id;

  DELETE FROM public.shifts WHERE id = _shift_id;
END;
$$;