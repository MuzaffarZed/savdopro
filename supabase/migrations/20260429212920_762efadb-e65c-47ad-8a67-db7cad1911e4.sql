
-- ============================================
-- ENUMS
-- ============================================
CREATE TYPE public.app_role AS ENUM ('super_admin', 'branch_user');
CREATE TYPE public.warehouse_type AS ENUM ('main', 'branch');
CREATE TYPE public.movement_type AS ENUM ('purchase', 'transfer_out', 'transfer_in', 'sale', 'rollback');
CREATE TYPE public.payment_method AS ENUM ('cash', 'click');

-- ============================================
-- BRANCHES
-- ============================================
CREATE TABLE public.branches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  address TEXT,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================
-- PROFILES
-- ============================================
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  phone TEXT,
  username TEXT UNIQUE,
  branch_id UUID REFERENCES public.branches(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================
-- USER ROLES (separate table — security best practice)
-- ============================================
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);

-- ============================================
-- SECURITY DEFINER functions for RLS
-- ============================================
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  )
$$;

CREATE OR REPLACE FUNCTION public.get_user_branch(_user_id UUID)
RETURNS UUID
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT branch_id FROM public.profiles WHERE id = _user_id
$$;

CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.has_role(auth.uid(), 'super_admin')
$$;

-- ============================================
-- WAREHOUSES
-- ============================================
CREATE TABLE public.warehouses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  type public.warehouse_type NOT NULL,
  branch_id UUID REFERENCES public.branches(id) ON DELETE CASCADE,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT main_warehouse_no_branch CHECK (
    (type = 'main' AND branch_id IS NULL) OR
    (type = 'branch' AND branch_id IS NOT NULL)
  )
);
CREATE UNIQUE INDEX one_main_warehouse ON public.warehouses (type) WHERE type = 'main' AND deleted_at IS NULL;
CREATE UNIQUE INDEX one_warehouse_per_branch ON public.warehouses (branch_id) WHERE branch_id IS NOT NULL AND deleted_at IS NULL;

-- ============================================
-- PRODUCTS
-- ============================================
CREATE TABLE public.products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  category TEXT,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================
-- CUSTOMERS
-- ============================================
CREATE TABLE public.customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  phone TEXT,
  balance NUMERIC(14,2) NOT NULL DEFAULT 0,
  branch_id UUID REFERENCES public.branches(id) ON DELETE SET NULL,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================
-- INVENTORY BATCHES (FIFO core)
-- ============================================
CREATE TABLE public.inventory_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES public.products(id),
  warehouse_id UUID NOT NULL REFERENCES public.warehouses(id),
  quantity NUMERIC(14,3) NOT NULL CHECK (quantity > 0),
  remaining NUMERIC(14,3) NOT NULL CHECK (remaining >= 0),
  cost_price NUMERIC(14,2) NOT NULL CHECK (cost_price >= 0),
  source_batch_id UUID REFERENCES public.inventory_batches(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_batches_fifo ON public.inventory_batches (product_id, warehouse_id, created_at) WHERE remaining > 0;

-- ============================================
-- INVENTORY MOVEMENTS (immutable history)
-- ============================================
CREATE TABLE public.inventory_movements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type public.movement_type NOT NULL,
  product_id UUID NOT NULL REFERENCES public.products(id),
  warehouse_id UUID NOT NULL REFERENCES public.warehouses(id),
  batch_id UUID REFERENCES public.inventory_batches(id),
  quantity NUMERIC(14,3) NOT NULL,
  cost_price NUMERIC(14,2),
  ref_type TEXT,
  ref_id UUID,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_movements_ref ON public.inventory_movements (ref_type, ref_id);

-- ============================================
-- PURCHASES
-- ============================================
CREATE TABLE public.purchases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES public.products(id),
  warehouse_id UUID NOT NULL REFERENCES public.warehouses(id),
  quantity NUMERIC(14,3) NOT NULL CHECK (quantity > 0),
  cost_price NUMERIC(14,2) NOT NULL CHECK (cost_price >= 0),
  total_cost NUMERIC(14,2) NOT NULL,
  note TEXT,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================
-- SALES
-- ============================================
CREATE TABLE public.sales (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id UUID NOT NULL REFERENCES public.branches(id),
  warehouse_id UUID NOT NULL REFERENCES public.warehouses(id),
  customer_id UUID REFERENCES public.customers(id),
  total_sale NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_cost NUMERIC(14,2) NOT NULL DEFAULT 0,
  profit NUMERIC(14,2) NOT NULL DEFAULT 0,
  amount_paid NUMERIC(14,2) NOT NULL DEFAULT 0,
  remaining_debt NUMERIC(14,2) NOT NULL DEFAULT 0,
  payment_method public.payment_method,
  status TEXT NOT NULL DEFAULT 'completed',
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_sales_branch ON public.sales (branch_id, created_at DESC);

-- ============================================
-- SALE ITEMS
-- ============================================
CREATE TABLE public.sale_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id UUID NOT NULL REFERENCES public.sales(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products(id),
  quantity NUMERIC(14,3) NOT NULL CHECK (quantity > 0),
  sell_price NUMERIC(14,2) NOT NULL CHECK (sell_price >= 0),
  total_price NUMERIC(14,2) NOT NULL,
  total_cost NUMERIC(14,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================
-- PAYMENTS
-- ============================================
CREATE TABLE public.payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id UUID REFERENCES public.sales(id) ON DELETE CASCADE,
  customer_id UUID REFERENCES public.customers(id),
  amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  method public.payment_method NOT NULL,
  note TEXT,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================
-- IDEMPOTENCY KEYS
-- ============================================
CREATE TABLE public.idempotency_keys (
  key TEXT PRIMARY KEY,
  user_id UUID NOT NULL,
  result_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_idempotency_age ON public.idempotency_keys (created_at);

-- ============================================
-- TRIGGER: auto-create profile on signup
-- ============================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, name, username)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)),
    COALESCE(NEW.raw_user_meta_data->>'username', NEW.email)
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============================================
-- TRIGGER: updated_at
-- ============================================
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE TRIGGER trg_branches_updated BEFORE UPDATE ON public.branches FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER trg_profiles_updated BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER trg_products_updated BEFORE UPDATE ON public.products FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER trg_customers_updated BEFORE UPDATE ON public.customers FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ============================================
-- FIFO: process_purchase
-- ============================================
CREATE OR REPLACE FUNCTION public.process_purchase(
  _product_id UUID,
  _warehouse_id UUID,
  _quantity NUMERIC,
  _cost_price NUMERIC,
  _note TEXT,
  _user_id UUID,
  _idempotency_key TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing UUID;
  v_purchase_id UUID;
  v_batch_id UUID;
BEGIN
  -- Idempotency check
  IF _idempotency_key IS NOT NULL THEN
    SELECT result_id INTO v_existing FROM public.idempotency_keys WHERE key = _idempotency_key;
    IF FOUND THEN RETURN v_existing; END IF;
  END IF;

  IF _quantity <= 0 THEN RAISE EXCEPTION 'Quantity must be positive'; END IF;
  IF _cost_price < 0 THEN RAISE EXCEPTION 'Cost price cannot be negative'; END IF;

  -- Create batch
  INSERT INTO public.inventory_batches (product_id, warehouse_id, quantity, remaining, cost_price)
  VALUES (_product_id, _warehouse_id, _quantity, _quantity, _cost_price)
  RETURNING id INTO v_batch_id;

  -- Create purchase record
  INSERT INTO public.purchases (product_id, warehouse_id, quantity, cost_price, total_cost, note, created_by)
  VALUES (_product_id, _warehouse_id, _quantity, _cost_price, _quantity * _cost_price, _note, _user_id)
  RETURNING id INTO v_purchase_id;

  -- Movement
  INSERT INTO public.inventory_movements (type, product_id, warehouse_id, batch_id, quantity, cost_price, ref_type, ref_id, created_by)
  VALUES ('purchase', _product_id, _warehouse_id, v_batch_id, _quantity, _cost_price, 'purchase', v_purchase_id, _user_id);

  -- Idempotency record
  IF _idempotency_key IS NOT NULL THEN
    INSERT INTO public.idempotency_keys (key, user_id, result_id) VALUES (_idempotency_key, _user_id, v_purchase_id);
  END IF;

  RETURN v_purchase_id;
END;
$$;

-- ============================================
-- FIFO: process_sale (THE CORE)
-- ============================================
CREATE OR REPLACE FUNCTION public.process_sale(
  _branch_id UUID,
  _warehouse_id UUID,
  _customer_id UUID,
  _items JSONB, -- [{"product_id":"...","quantity":N,"sell_price":N}]
  _amount_paid NUMERIC,
  _payment_method public.payment_method,
  _user_id UUID,
  _idempotency_key TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing UUID;
  v_sale_id UUID;
  v_item JSONB;
  v_product_id UUID;
  v_quantity NUMERIC;
  v_sell_price NUMERIC;
  v_required NUMERIC;
  v_used NUMERIC;
  v_item_cost NUMERIC;
  v_item_total NUMERIC;
  v_total_sale NUMERIC := 0;
  v_total_cost NUMERIC := 0;
  v_remaining_debt NUMERIC;
  v_sale_item_id UUID;
  v_batch RECORD;
BEGIN
  -- Idempotency
  IF _idempotency_key IS NOT NULL THEN
    SELECT result_id INTO v_existing FROM public.idempotency_keys WHERE key = _idempotency_key;
    IF FOUND THEN RETURN v_existing; END IF;
  END IF;

  IF jsonb_array_length(_items) = 0 THEN RAISE EXCEPTION 'No items in sale'; END IF;
  IF _amount_paid < 0 THEN RAISE EXCEPTION 'Amount paid cannot be negative'; END IF;

  -- Create sale shell
  INSERT INTO public.sales (branch_id, warehouse_id, customer_id, amount_paid, payment_method, created_by)
  VALUES (_branch_id, _warehouse_id, _customer_id, _amount_paid, _payment_method, _user_id)
  RETURNING id INTO v_sale_id;

  -- Process each item with FIFO
  FOR v_item IN SELECT * FROM jsonb_array_elements(_items)
  LOOP
    v_product_id := (v_item->>'product_id')::UUID;
    v_quantity := (v_item->>'quantity')::NUMERIC;
    v_sell_price := (v_item->>'sell_price')::NUMERIC;

    IF v_quantity <= 0 THEN RAISE EXCEPTION 'Item quantity must be > 0'; END IF;
    IF v_sell_price < 0 THEN RAISE EXCEPTION 'Sell price cannot be negative'; END IF;

    v_item_total := v_quantity * v_sell_price;
    v_item_cost := 0;
    v_required := v_quantity;

    -- Create sale_item
    INSERT INTO public.sale_items (sale_id, product_id, quantity, sell_price, total_price)
    VALUES (v_sale_id, v_product_id, v_quantity, v_sell_price, v_item_total)
    RETURNING id INTO v_sale_item_id;

    -- FIFO consume with FOR UPDATE
    FOR v_batch IN
      SELECT id, remaining, cost_price
      FROM public.inventory_batches
      WHERE product_id = v_product_id
        AND warehouse_id = _warehouse_id
        AND remaining > 0
      ORDER BY created_at ASC
      FOR UPDATE
    LOOP
      EXIT WHEN v_required <= 0;
      v_used := LEAST(v_batch.remaining, v_required);

      UPDATE public.inventory_batches
      SET remaining = remaining - v_used
      WHERE id = v_batch.id;

      INSERT INTO public.inventory_movements
        (type, product_id, warehouse_id, batch_id, quantity, cost_price, ref_type, ref_id, created_by)
      VALUES
        ('sale', v_product_id, _warehouse_id, v_batch.id, -v_used, v_batch.cost_price, 'sale_item', v_sale_item_id, _user_id);

      v_item_cost := v_item_cost + (v_used * v_batch.cost_price);
      v_required := v_required - v_used;
    END LOOP;

    IF v_required > 0 THEN
      RAISE EXCEPTION 'Not enough stock for product %. Missing: %', v_product_id, v_required;
    END IF;

    UPDATE public.sale_items SET total_cost = v_item_cost WHERE id = v_sale_item_id;

    v_total_sale := v_total_sale + v_item_total;
    v_total_cost := v_total_cost + v_item_cost;
  END LOOP;

  v_remaining_debt := v_total_sale - _amount_paid;

  -- Update sale totals
  UPDATE public.sales
  SET total_sale = v_total_sale,
      total_cost = v_total_cost,
      profit = v_total_sale - v_total_cost,
      remaining_debt = GREATEST(v_remaining_debt, 0)
  WHERE id = v_sale_id;

  -- Payment record
  IF _amount_paid > 0 THEN
    INSERT INTO public.payments (sale_id, customer_id, amount, method, created_by)
    VALUES (v_sale_id, _customer_id, _amount_paid, _payment_method, _user_id);
  END IF;

  -- Customer debt
  IF v_remaining_debt > 0 AND _customer_id IS NOT NULL THEN
    UPDATE public.customers SET balance = balance + v_remaining_debt WHERE id = _customer_id;
  ELSIF v_remaining_debt < 0 AND _customer_id IS NOT NULL THEN
    -- Overpayment reduces existing debt
    UPDATE public.customers SET balance = balance + v_remaining_debt WHERE id = _customer_id;
  END IF;

  IF _idempotency_key IS NOT NULL THEN
    INSERT INTO public.idempotency_keys (key, user_id, result_id) VALUES (_idempotency_key, _user_id, v_sale_id);
  END IF;

  RETURN v_sale_id;
END;
$$;

-- ============================================
-- FIFO: rollback_sale
-- ============================================
CREATE OR REPLACE FUNCTION public.rollback_sale(_sale_id UUID, _user_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sale RECORD;
  v_mov RECORD;
BEGIN
  SELECT * INTO v_sale FROM public.sales WHERE id = _sale_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Sale not found'; END IF;
  IF v_sale.status = 'rolled_back' THEN RAISE EXCEPTION 'Sale already rolled back'; END IF;

  -- Restore batches
  FOR v_mov IN
    SELECT batch_id, quantity, product_id, warehouse_id, cost_price
    FROM public.inventory_movements
    WHERE ref_type = 'sale_item' AND type = 'sale'
      AND ref_id IN (SELECT id FROM public.sale_items WHERE sale_id = _sale_id)
  LOOP
    UPDATE public.inventory_batches
    SET remaining = remaining + ABS(v_mov.quantity)
    WHERE id = v_mov.batch_id;

    INSERT INTO public.inventory_movements
      (type, product_id, warehouse_id, batch_id, quantity, cost_price, ref_type, ref_id, created_by)
    VALUES
      ('rollback', v_mov.product_id, v_mov.warehouse_id, v_mov.batch_id, ABS(v_mov.quantity), v_mov.cost_price, 'sale_rollback', _sale_id, _user_id);
  END LOOP;

  -- Reverse customer debt
  IF v_sale.customer_id IS NOT NULL AND v_sale.remaining_debt > 0 THEN
    UPDATE public.customers SET balance = balance - v_sale.remaining_debt WHERE id = v_sale.customer_id;
  END IF;

  UPDATE public.sales SET status = 'rolled_back' WHERE id = _sale_id;
END;
$$;

-- ============================================
-- ROW LEVEL SECURITY
-- ============================================
ALTER TABLE public.branches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.warehouses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sale_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.idempotency_keys ENABLE ROW LEVEL SECURITY;

-- BRANCHES
CREATE POLICY "All authenticated can view branches" ON public.branches FOR SELECT TO authenticated USING (deleted_at IS NULL);
CREATE POLICY "Super admin manages branches" ON public.branches FOR ALL TO authenticated USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());

-- PROFILES
CREATE POLICY "Users view own profile" ON public.profiles FOR SELECT TO authenticated USING (id = auth.uid() OR public.is_super_admin());
CREATE POLICY "Users update own profile" ON public.profiles FOR UPDATE TO authenticated USING (id = auth.uid() OR public.is_super_admin());
CREATE POLICY "Super admin inserts profiles" ON public.profiles FOR INSERT TO authenticated WITH CHECK (public.is_super_admin() OR id = auth.uid());

-- USER_ROLES
CREATE POLICY "Users view own roles" ON public.user_roles FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.is_super_admin());
CREATE POLICY "Super admin manages roles" ON public.user_roles FOR ALL TO authenticated USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());

-- WAREHOUSES
CREATE POLICY "All view warehouses" ON public.warehouses FOR SELECT TO authenticated USING (deleted_at IS NULL);
CREATE POLICY "Super admin manages warehouses" ON public.warehouses FOR ALL TO authenticated USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());

-- PRODUCTS
CREATE POLICY "All view products" ON public.products FOR SELECT TO authenticated USING (deleted_at IS NULL);
CREATE POLICY "Super admin manages products" ON public.products FOR ALL TO authenticated USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());

-- CUSTOMERS
CREATE POLICY "View customers in scope" ON public.customers FOR SELECT TO authenticated USING (
  deleted_at IS NULL AND (
    public.is_super_admin() OR branch_id IS NULL OR branch_id = public.get_user_branch(auth.uid())
  )
);
CREATE POLICY "Insert customers" ON public.customers FOR INSERT TO authenticated WITH CHECK (
  public.is_super_admin() OR branch_id = public.get_user_branch(auth.uid())
);
CREATE POLICY "Update customers" ON public.customers FOR UPDATE TO authenticated USING (
  public.is_super_admin() OR branch_id = public.get_user_branch(auth.uid())
);

-- INVENTORY BATCHES
CREATE POLICY "View batches in scope" ON public.inventory_batches FOR SELECT TO authenticated USING (
  public.is_super_admin() OR warehouse_id IN (
    SELECT id FROM public.warehouses WHERE branch_id = public.get_user_branch(auth.uid()) OR type = 'main'
  )
);

-- INVENTORY MOVEMENTS
CREATE POLICY "View movements in scope" ON public.inventory_movements FOR SELECT TO authenticated USING (
  public.is_super_admin() OR warehouse_id IN (
    SELECT id FROM public.warehouses WHERE branch_id = public.get_user_branch(auth.uid()) OR type = 'main'
  )
);

-- PURCHASES
CREATE POLICY "View purchases" ON public.purchases FOR SELECT TO authenticated USING (
  public.is_super_admin() OR warehouse_id IN (
    SELECT id FROM public.warehouses WHERE branch_id = public.get_user_branch(auth.uid()) OR type = 'main'
  )
);

-- SALES
CREATE POLICY "View sales in branch" ON public.sales FOR SELECT TO authenticated USING (
  public.is_super_admin() OR branch_id = public.get_user_branch(auth.uid())
);

-- SALE ITEMS
CREATE POLICY "View sale items in scope" ON public.sale_items FOR SELECT TO authenticated USING (
  sale_id IN (SELECT id FROM public.sales WHERE public.is_super_admin() OR branch_id = public.get_user_branch(auth.uid()))
);

-- PAYMENTS
CREATE POLICY "View payments in scope" ON public.payments FOR SELECT TO authenticated USING (
  public.is_super_admin() OR
  sale_id IN (SELECT id FROM public.sales WHERE branch_id = public.get_user_branch(auth.uid()))
);

-- IDEMPOTENCY: only owner reads
CREATE POLICY "Own idempotency keys" ON public.idempotency_keys FOR SELECT TO authenticated USING (user_id = auth.uid());
