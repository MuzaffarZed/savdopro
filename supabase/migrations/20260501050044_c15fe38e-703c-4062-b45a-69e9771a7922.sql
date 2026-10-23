-- open_shift'ga _target_user_id qo'shamiz (admin sotuvchi uchun ochsin)
CREATE OR REPLACE FUNCTION public.open_shift(
  _branch_id uuid,
  _warehouse_id uuid,
  _opening_cash numeric,
  _user_id uuid,
  _target_user_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_id UUID;
  v_existing UUID;
  v_is_admin BOOLEAN;
  v_for_user UUID;
BEGIN
  SELECT public.has_role(_user_id, 'super_admin') INTO v_is_admin;

  -- Faqat admin boshqa user uchun ocha oladi
  IF _target_user_id IS NOT NULL AND _target_user_id <> _user_id THEN
    IF NOT v_is_admin THEN RAISE EXCEPTION 'Faqat admin boshqa foydalanuvchi uchun smena ocha oladi'; END IF;
    v_for_user := _target_user_id;
  ELSE
    v_for_user := _user_id;
  END IF;

  -- O'sha sklad uchun ushbu user'da ochiq smena bor-yo'qligini tekshir
  SELECT id INTO v_existing FROM public.shifts
    WHERE user_id = v_for_user AND warehouse_id = _warehouse_id AND status = 'open' LIMIT 1;
  IF FOUND THEN RAISE EXCEPTION 'Bu sklad uchun ushbu foydalanuvchida allaqachon ochiq smena bor'; END IF;

  -- Sotuvchi (admin emas) bo'lsa: faqat 1ta umumiy ochiq smena
  IF NOT public.has_role(v_for_user, 'super_admin') THEN
    SELECT id INTO v_existing FROM public.shifts WHERE user_id = v_for_user AND status = 'open' LIMIT 1;
    IF FOUND THEN RAISE EXCEPTION 'Bu foydalanuvchida allaqachon ochiq smena bor'; END IF;
  END IF;

  INSERT INTO public.shifts (user_id, branch_id, warehouse_id, opening_cash)
  VALUES (v_for_user, _branch_id, _warehouse_id, COALESCE(_opening_cash, 0))
  RETURNING id INTO v_id;
  RETURN v_id;
END $function$;