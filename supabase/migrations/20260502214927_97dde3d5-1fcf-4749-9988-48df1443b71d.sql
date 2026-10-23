-- Allow sellers to view standalone debt payments for customers in their branch
DROP POLICY IF EXISTS "View payments in scope" ON public.payments;
CREATE POLICY "View payments in scope"
ON public.payments
FOR SELECT
TO authenticated
USING (
  is_super_admin()
  OR (sale_id IN (SELECT id FROM public.sales WHERE branch_id = get_user_branch(auth.uid())))
  OR (customer_id IN (SELECT id FROM public.customers WHERE branch_id = get_user_branch(auth.uid())))
);