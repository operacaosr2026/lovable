CREATE TABLE IF NOT EXISTS lg_card_goals (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  card_id    UUID NOT NULL REFERENCES lg_cards(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  meta       NUMERIC(14,2) NOT NULL,
  prazo      DATE NOT NULL,
  start_date DATE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(card_id, user_id)
);

ALTER TABLE lg_card_goals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "owner" ON lg_card_goals
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
