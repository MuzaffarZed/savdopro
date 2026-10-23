-- Allow super admins to update payment records
CREATE POLICY "Super admin updates payments"
ON public.payments
FOR UPDATE
TO authenticated
USING (public.is_super_admin())
WITH CHECK (public.is_super_admin());

-- Allow super admins to delete payment records
CREATE POLICY "Super admin deletes payments"
ON public.payments
FOR DELETE
TO authenticated
USING (public.is_super_admin());