
-- ============ bank_connections ============
CREATE TABLE public.bank_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  provider text NOT NULL CHECK (provider IN ('mercury','wise')),
  label text NOT NULL,
  access_token_encrypted text NOT NULL,
  wise_profile_id text,
  last_sync_at timestamptz,
  last_sync_status text,
  last_sync_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.bank_connections TO authenticated;
GRANT ALL ON public.bank_connections TO service_role;
ALTER TABLE public.bank_connections ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own bank_connections all" ON public.bank_connections
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER trg_bank_connections_updated_at BEFORE UPDATE ON public.bank_connections
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============ bank_account_links ============
CREATE TABLE public.bank_account_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  connection_id uuid NOT NULL REFERENCES public.bank_connections(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  external_account_id text NOT NULL,
  external_account_name text,
  external_currency text,
  last_external_uid text,
  last_synced_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (connection_id, external_account_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.bank_account_links TO authenticated;
GRANT ALL ON public.bank_account_links TO service_role;
ALTER TABLE public.bank_account_links ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own bank_account_links all" ON public.bank_account_links
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER trg_bank_account_links_updated_at BEFORE UPDATE ON public.bank_account_links
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============ category_rules ============
CREATE TABLE public.category_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  match_value text NOT NULL,
  match_type text NOT NULL DEFAULT 'contains' CHECK (match_type IN ('contains','equals','regex')),
  category_id uuid NOT NULL REFERENCES public.categories(id) ON DELETE CASCADE,
  position integer NOT NULL DEFAULT 0,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.category_rules TO authenticated;
GRANT ALL ON public.category_rules TO service_role;
ALTER TABLE public.category_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own category_rules all" ON public.category_rules
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER trg_category_rules_updated_at BEFORE UPDATE ON public.category_rules
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============ transactions extensions ============
ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS external_id text,
  ADD COLUMN IF NOT EXISTS needs_review boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS import_source text NOT NULL DEFAULT 'manual';

CREATE UNIQUE INDEX IF NOT EXISTS uniq_tx_external_per_account
  ON public.transactions (user_id, account_id, external_id)
  WHERE external_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_tx_needs_review ON public.transactions (user_id, needs_review) WHERE needs_review = true;
