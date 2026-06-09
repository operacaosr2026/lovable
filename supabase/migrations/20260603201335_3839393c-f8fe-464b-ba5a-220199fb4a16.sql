
CREATE TABLE public.mercury_links (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  shop_id uuid NOT NULL UNIQUE,
  mercury_account_id text NOT NULL,
  mercury_account_name text,
  sync_since date NOT NULL DEFAULT CURRENT_DATE,
  last_sync_at timestamptz,
  last_sync_status text,
  last_sync_error text,
  cached_balance numeric,
  cached_balance_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.mercury_links TO authenticated;
GRANT ALL ON public.mercury_links TO service_role;
ALTER TABLE public.mercury_links ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own mercury_links all" ON public.mercury_links FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "members access mercury_links" ON public.mercury_links FOR ALL
  USING (has_workspace_access(auth.uid(), user_id, 'shops', shop_id))
  WITH CHECK (has_workspace_access(auth.uid(), user_id, 'shops', shop_id));
CREATE TRIGGER set_mercury_links_updated_at BEFORE UPDATE ON public.mercury_links FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.mercury_category_rules (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  shop_id uuid NOT NULL,
  match_field text NOT NULL DEFAULT 'description',
  match_type text NOT NULL DEFAULT 'contains',
  match_value text NOT NULL,
  target_kind text NOT NULL,
  target_category text NOT NULL,
  position integer NOT NULL DEFAULT 0,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.mercury_category_rules TO authenticated;
GRANT ALL ON public.mercury_category_rules TO service_role;
ALTER TABLE public.mercury_category_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own mercury_category_rules all" ON public.mercury_category_rules FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "members access mercury_category_rules" ON public.mercury_category_rules FOR ALL
  USING (has_workspace_access(auth.uid(), user_id, 'shops', shop_id))
  WITH CHECK (has_workspace_access(auth.uid(), user_id, 'shops', shop_id));
CREATE TRIGGER set_mercury_rules_updated_at BEFORE UPDATE ON public.mercury_category_rules FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE INDEX mercury_rules_shop_pos_idx ON public.mercury_category_rules (shop_id, position);

ALTER TABLE public.shop_cash_entries ADD COLUMN IF NOT EXISTS mercury_transaction_id text;
CREATE UNIQUE INDEX IF NOT EXISTS shop_cash_entries_mercury_unique
  ON public.shop_cash_entries (shop_id, mercury_transaction_id)
  WHERE mercury_transaction_id IS NOT NULL;
