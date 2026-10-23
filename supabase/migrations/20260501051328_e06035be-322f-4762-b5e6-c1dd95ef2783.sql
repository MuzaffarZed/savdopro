REVOKE EXECUTE ON FUNCTION public.open_shift(uuid, uuid, numeric, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.open_shift(uuid, uuid, numeric, uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.close_shift(uuid, numeric, text, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.process_sale(uuid, uuid, uuid, jsonb, numeric, payment_method, uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.process_debt_payment(uuid, numeric, payment_method, text, uuid, text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.open_shift(uuid, uuid, numeric, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.open_shift(uuid, uuid, numeric, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.close_shift(uuid, numeric, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.process_sale(uuid, uuid, uuid, jsonb, numeric, payment_method, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.process_debt_payment(uuid, numeric, payment_method, text, uuid, text) TO authenticated;