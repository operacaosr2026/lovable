
-- Meta Ads integration

CREATE TABLE public.meta_ads_integrations (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  shop_id uuid NOT NULL UNIQUE,
  access_token text,
  ad_account_id text,
  account_name text,
  currency text,
  enabled boolean NOT NULL DEFAULT false,
  last_sync_at timestamptz,
  last_sync_status text,
  last_sync_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.meta_ads_integrations TO authenticated;
GRANT ALL ON public.meta_ads_integrations TO service_role;

ALTER TABLE public.meta_ads_integrations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own meta_ads_integrations all" ON public.meta_ads_integrations
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "members access meta_ads_integrations" ON public.meta_ads_integrations
  FOR ALL USING (has_workspace_access(auth.uid(), user_id, 'shops', shop_id))
  WITH CHECK (has_workspace_access(auth.uid(), user_id, 'shops', shop_id));

CREATE TRIGGER meta_ads_integrations_updated_at BEFORE UPDATE ON public.meta_ads_integrations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
