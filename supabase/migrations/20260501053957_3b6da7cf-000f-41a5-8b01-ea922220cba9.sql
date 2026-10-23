DROP FUNCTION IF EXISTS public.open_shift(uuid, uuid, numeric, uuid, uuid);

CREATE OR REPLACE FUNCTION public.open_shift(_branch_id uuid, _warehouse_id uuid, _opening_cash numeric, _user_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid;
  v_existing uuid;
  v_allowed boolean;
BEGIN
  IF auth.uid() IS NULL OR auth.uid() <> _user_id THEN
    RAISE EXCEPTION 'Ruxsat yo''q';
  END IF;

  SELECT (
    public.is_super_admin()
    OR _branch_id = public.get_user_branch(_user_id)
  ) INTO v_allowed;

  IF NOT v_allowed THEN
    RAISE EXCEPTION 'Bu filial uchun smena ochishga ruxsat yo''q';
  END IF;

  SELECT id INTO v_existing
  FROM public.shifts
  WHERE warehouse_id = _warehouse_id
    AND branch_id = _branch_id
    AND status = 'open'
  ORDER BY opened_at DESC
  LIMIT 1;

  IF v_existing IS NOT NULL THEN
    RAISE EXCEPTION 'Bu sklad uchun allaqachon ochiq smena bor. Avval ochiq smenani yoping.';
  END IF;

  INSERT INTO public.shifts (user_id, branch_id, warehouse_id, opening_cash)
  VALUES (_user_id, _branch_id, _warehouse_id, COALESCE(_opening_cash, 0))
  RETURNING id INTO v_id;

  RETURN v_id;
END
$function$;