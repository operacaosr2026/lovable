-- Unificar meta_shop_id → matriz_shop_id (matriz = loja de anúncios + tráfego)
ALTER TABLE lg_cards ADD COLUMN IF NOT EXISTS matriz_shop_id UUID REFERENCES shops(id) ON DELETE SET NULL;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='lg_cards' AND column_name='meta_shop_id') THEN
    UPDATE lg_cards SET matriz_shop_id = meta_shop_id WHERE meta_shop_id IS NOT NULL AND matriz_shop_id IS NULL;
    ALTER TABLE lg_cards DROP COLUMN meta_shop_id;
  END IF;
END $$;

-- Visitantes por dia por loja (sync da Shopify analytics)
CREATE TABLE IF NOT EXISTS shop_daily_analytics (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id    UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  date       DATE NOT NULL,
  sessions   INTEGER NOT NULL DEFAULT 0,
  UNIQUE(shop_id, date)
);
ALTER TABLE shop_daily_analytics ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "owner" ON shop_daily_analytics;
CREATE POLICY "owner" ON shop_daily_analytics USING (user_id = auth.uid());

-- Campo visitantes manual na nota (fallback)
ALTER TABLE lg_card_notes ADD COLUMN IF NOT EXISTS visitors INTEGER;

-- Taxa de câmbio por card/usuário
CREATE TABLE IF NOT EXISTS lg_card_currency_rates (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  card_id    UUID NOT NULL REFERENCES lg_cards(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  brl_rate   NUMERIC(10,4) NOT NULL DEFAULT 5.0,
  eur_rate   NUMERIC(10,4) NOT NULL DEFAULT 0.92,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(card_id, user_id)
);
ALTER TABLE lg_card_currency_rates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "owner" ON lg_card_currency_rates;
CREATE POLICY "owner" ON lg_card_currency_rates USING (user_id = auth.uid());
