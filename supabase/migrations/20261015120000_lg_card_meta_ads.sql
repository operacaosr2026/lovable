-- Meta Ads do card de Lojas e Grupos: as campanhas e o gasto são do card, não
-- das lojas. Antes cada loja gravava o gasto das campanhas marcadas nela e o
-- card somava as lojas — campanha marcada em duas lojas entrava em dobro, e
-- entrar/sair loja do card mudava o gasto.

CREATE TABLE IF NOT EXISTS lg_card_meta_accounts (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  card_id               UUID NOT NULL REFERENCES lg_cards(id) ON DELETE CASCADE,
  ad_account_id         TEXT NOT NULL,
  account_name          TEXT,
  currency              TEXT,
  -- Vazio = todas as campanhas da conta.
  selected_campaign_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  enabled               BOOLEAN NOT NULL DEFAULT true,
  last_sync_at          TIMESTAMPTZ,
  last_sync_status      TEXT,
  last_sync_error       TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (card_id, ad_account_id)
);

CREATE TABLE IF NOT EXISTS lg_card_ad_spend (
  card_id    UUID NOT NULL REFERENCES lg_cards(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  date       DATE NOT NULL,
  amount     NUMERIC(14,2) NOT NULL DEFAULT 0,
  synced_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (card_id, date)
);
CREATE INDEX IF NOT EXISTS lg_card_ad_spend_user_date ON lg_card_ad_spend (user_id, date);

ALTER TABLE lg_card_meta_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE lg_card_ad_spend ENABLE ROW LEVEL SECURITY;

CREATE POLICY "members access lg_card_meta_accounts" ON lg_card_meta_accounts FOR ALL
  USING (public.has_workspace_access(auth.uid(), user_id, 'shops', NULL))
  WITH CHECK (public.has_workspace_access(auth.uid(), user_id, 'shops', NULL));

CREATE POLICY "members access lg_card_ad_spend" ON lg_card_ad_spend FOR ALL
  USING (public.has_workspace_access(auth.uid(), user_id, 'shops', NULL))
  WITH CHECK (public.has_workspace_access(auth.uid(), user_id, 'shops', NULL));
