-- Permite conectar múltiplas contas de anúncio Meta por loja, mantendo o mesmo login (shop_meta_tokens).

CREATE TABLE IF NOT EXISTS public.shop_meta_ad_accounts (
  id                       uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id                  uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  shop_id                  uuid NOT NULL,
  ad_account_id            text NOT NULL,
  account_name             text,
  currency                 text,
  enabled                  boolean NOT NULL DEFAULT true,
  selected_campaign_ids    jsonb DEFAULT '[]'::jsonb,
  last_sync_at             timestamptz,
  last_sync_status         text,
  last_sync_error          text,
  last_activities_sync_at  timestamptz,
  created_at               timestamptz DEFAULT now(),
  updated_at               timestamptz DEFAULT now(),
  UNIQUE (shop_id, ad_account_id)
);

ALTER TABLE public.shop_meta_ad_accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "shop_meta_ad_accounts_owner" ON public.shop_meta_ad_accounts
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

ALTER TABLE public.shop_meta_tokens
  ADD COLUMN IF NOT EXISTS activities_journal_page_id uuid;

-- Backfill: uma linha por loja já conectada hoje (selected_ad_account_id preenchido)
INSERT INTO public.shop_meta_ad_accounts (
  user_id, shop_id, ad_account_id, account_name, currency,
  selected_campaign_ids, last_sync_at, last_sync_status, last_sync_error, last_activities_sync_at
)
SELECT
  t.user_id, t.shop_id, t.selected_ad_account_id,
  acc.val->>'name', acc.val->>'currency',
  COALESCE(t.selected_campaign_ids, '[]'::jsonb),
  m.last_sync_at, m.last_sync_status, m.last_sync_error, m.last_activities_sync_at
FROM public.shop_meta_tokens t
LEFT JOIN LATERAL (
  SELECT elem AS val
  FROM jsonb_array_elements(COALESCE(t.ad_accounts, '[]'::jsonb)) AS elem
  WHERE elem->>'id' = t.selected_ad_account_id OR 'act_' || (elem->>'account_id') = t.selected_ad_account_id
  LIMIT 1
) acc ON true
LEFT JOIN public.meta_ads_integrations m ON m.shop_id = t.shop_id AND m.user_id = t.user_id
WHERE t.selected_ad_account_id IS NOT NULL
ON CONFLICT (shop_id, ad_account_id) DO NOTHING;

UPDATE public.shop_meta_tokens t SET activities_journal_page_id = m.journal_page_id
FROM public.meta_ads_integrations m
WHERE m.shop_id = t.shop_id AND m.user_id = t.user_id AND m.journal_page_id IS NOT NULL;
