-- Cobranças do cartão da Meta também das contas ligadas só no card (Lojas e
-- Grupos): antes só as contas das lojas (shop_meta_ad_accounts) entravam no
-- Caixa. Mesmas colunas e regra — ver syncMetaBillingCharges em
-- src/lib/meta-ads.functions.ts. Começa quando o cron vê a conta (o que passou,
-- passou: o que veio antes foi lançado à mão).

ALTER TABLE public.lg_card_meta_accounts
  ADD COLUMN IF NOT EXISTS billing_started_at   timestamptz,
  ADD COLUMN IF NOT EXISTS billing_synced_until timestamptz,
  ADD COLUMN IF NOT EXISTS billing_seen_tx      text[] NOT NULL DEFAULT '{}';
