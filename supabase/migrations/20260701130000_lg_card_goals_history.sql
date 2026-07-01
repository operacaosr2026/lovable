-- Permite múltiplas metas por card (histórico) em vez de uma única linha
-- sobrescrita a cada save. Uma meta fica "ativa" enquanto closed_at for NULL
-- e o prazo não tiver vencido; pode ser encerrada manualmente (closed_at) ou
-- naturalmente ao passar do prazo.
ALTER TABLE lg_card_goals DROP CONSTRAINT IF EXISTS lg_card_goals_card_id_user_id_key;
ALTER TABLE lg_card_goals ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_lg_card_goals_card_id ON lg_card_goals(card_id, user_id);
