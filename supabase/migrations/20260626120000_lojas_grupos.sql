-- ─────────────────────────────────────────────────────────────────────────────
-- Lojas e Grupos — nova seção unificada de ecommerce
-- ─────────────────────────────────────────────────────────────────────────────

-- Entidade principal do card
CREATE TABLE IF NOT EXISTS lg_cards (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL CHECK (char_length(name) <= 120),
  description TEXT,
  status      TEXT NOT NULL DEFAULT 'ativo' CHECK (status IN ('ativo','pausado','arquivado')),
  logo_url    TEXT,
  country     TEXT,
  tag         TEXT,
  meta_shop_id UUID REFERENCES shops(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE lg_cards ENABLE ROW LEVEL SECURITY;

CREATE POLICY "lg_cards_user_policy" ON lg_cards
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Ligação card → lojas (shops), com configurações por loja
CREATE TABLE IF NOT EXISTS lg_card_shops (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  card_id      UUID NOT NULL REFERENCES lg_cards(id) ON DELETE CASCADE,
  shop_id      UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  payout_days  INTEGER NOT NULL DEFAULT 10,  -- D+X: estimativa de repasse pendente
  payment_days INTEGER NOT NULL DEFAULT 7,   -- prazo para pagar fornecedor após pedido
  UNIQUE(card_id, shop_id)
);

ALTER TABLE lg_card_shops ENABLE ROW LEVEL SECURITY;

CREATE POLICY "lg_card_shops_user_policy" ON lg_card_shops
  USING (
    EXISTS (
      SELECT 1 FROM lg_cards
      WHERE lg_cards.id = lg_card_shops.card_id
        AND lg_cards.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM lg_cards
      WHERE lg_cards.id = lg_card_shops.card_id
        AND lg_cards.user_id = auth.uid()
    )
  );

-- Notas/diário por card
CREATE TABLE IF NOT EXISTS lg_card_notes (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  card_id   UUID NOT NULL REFERENCES lg_cards(id) ON DELETE CASCADE,
  user_id   UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  content   TEXT NOT NULL,
  note_date DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE lg_card_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "lg_card_notes_user_policy" ON lg_card_notes
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
