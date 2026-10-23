-- Allow all authenticated users to see and work with all customers regardless of branch
DROP POLICY IF EXISTS "View customers in scope" ON public.customers;
DROP POLICY IF EXISTS "Insert customers" ON public.customers;
DROP POLICY IF EXISTS "Update customers" ON public.customers;

CREATE POLICY "View all customers"
ON public.customers FOR SELECT
TO authenticated
USING (deleted_at IS NULL);

CREATE POLICY "Insert customers"
ON public.customers FOR INSERT
TO authenticated
WITH CHECK (true);

CREATE POLICY "Update customers"
ON public.customers FOR UPDATE
TO authenticated
USING (true);

-- Payments visibility: allow all authenticated to view payments (so customer ledgers work across branches)
DROP POLICY IF EXISTS "View payments in scope" ON public.payments;
CREATE POLICY "View payments"
ON public.payments FOR SELECT
TO authenticated
USING (true);