-- Mijozlarni faqat o'z filiali ko'rsin (branch_id IS NULL bo'lgan ham super_admin'gagina ko'rinsin)
DROP POLICY IF EXISTS "View customers in scope" ON public.customers;

CREATE POLICY "View customers in scope"
ON public.customers
FOR SELECT
TO authenticated
USING (
  deleted_at IS NULL
  AND (
    is_super_admin()
    OR (branch_id IS NOT NULL AND branch_id = get_user_branch(auth.uid()))
  )
);

-- Eski branch_id IS NULL bo'lgan mijozlarni "orphan" qilib qo'ymaslik uchun belgilab qo'yamiz
-- (super_admin tomonidan yaratilgan bo'lsa, ular faqat super_adminga ko'rinadi — bu xohlangan xulq)