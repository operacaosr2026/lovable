-- Cobranças do cartão da Meta (ad_account_billing_charge) entram no Caixa como
-- saída "Facebook Ads", pelo cron de anúncios (sync-ads). Ver
-- syncMetaBillingCharges em src/lib/meta-ads.functions.ts.
--   billing_started_at   — só entram cobranças a partir daqui (o que passou, passou)
--   billing_synced_until — última leitura das activities da conta
--   billing_seen_tx      — cobranças já lançadas; lançamento apagado no Caixa não volta

ALTER TABLE public.shop_meta_ad_accounts
  ADD COLUMN IF NOT EXISTS billing_started_at   timestamptz,
  ADD COLUMN IF NOT EXISTS billing_synced_until timestamptz,
  ADD COLUMN IF NOT EXISTS billing_seen_tx      text[] NOT NULL DEFAULT '{}';

-- Contas já conectadas: a partir de hoje (24/09/2026, 0h de Nova York — o
-- mesmo fuso do "hoje" do Caixa). Contas conectadas depois começam no
-- momento em que o cron as vê pela primeira vez.
UPDATE public.shop_meta_ad_accounts
SET billing_started_at = '2026-09-24 00:00:00 America/New_York'::timestamptz
WHERE billing_started_at IS NULL;
