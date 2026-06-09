
-- shop_order_settings
CREATE TABLE public.shop_order_settings (
  shop_id uuid PRIMARY KEY,
  user_id uuid NOT NULL,
  processing_delay_days integer NOT NULL DEFAULT 7,
  automation_enabled boolean NOT NULL DEFAULT true,
  default_unit_cost numeric NOT NULL DEFAULT 0,
  shopify_store_id uuid,
  linked_product_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.shop_order_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own shop_order_settings all" ON public.shop_order_settings
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER shop_order_settings_updated_at BEFORE UPDATE ON public.shop_order_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- shop_orders
CREATE TABLE public.shop_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  shop_id uuid NOT NULL,
  source text NOT NULL DEFAULT 'shopify',
  external_id text NOT NULL,
  order_number text,
  created_at_shopify timestamptz NOT NULL,
  order_date date NOT NULL,
  items_count integer NOT NULL DEFAULT 0,
  revenue numeric NOT NULL DEFAULT 0,
  currency text,
  raw jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (shop_id, source, external_id)
);
CREATE INDEX shop_orders_shop_date_idx ON public.shop_orders (shop_id, order_date);
ALTER TABLE public.shop_orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own shop_orders all" ON public.shop_orders
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER shop_orders_updated_at BEFORE UPDATE ON public.shop_orders
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- shop_product_cost_history
CREATE TABLE public.shop_product_cost_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  shop_id uuid NOT NULL,
  unit_cost numeric NOT NULL,
  valid_from date,
  valid_to date,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX shop_product_cost_history_shop_idx ON public.shop_product_cost_history (shop_id, valid_from);
ALTER TABLE public.shop_product_cost_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own shop_product_cost_history all" ON public.shop_product_cost_history
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- shop_cash_entries: auto fields
ALTER TABLE public.shop_cash_entries ADD COLUMN IF NOT EXISTS auto_kind text;
ALTER TABLE public.shop_cash_entries ADD COLUMN IF NOT EXISTS auto_ref_date date;
CREATE UNIQUE INDEX IF NOT EXISTS shop_cash_entries_auto_unique
  ON public.shop_cash_entries (shop_id, auto_kind, auto_ref_date)
  WHERE auto_kind IS NOT NULL;
