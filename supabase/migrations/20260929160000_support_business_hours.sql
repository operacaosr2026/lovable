-- Atendimento: horário comercial (Configurações > Metas). Tempo médio de
-- resposta, 1ª resposta e resolução só contam o tempo dentro dele.
-- Padrão: seg–sex (1..5; 0 = domingo), 8h às 19h de Brasília.
ALTER TABLE public.support_settings
  ADD COLUMN IF NOT EXISTS bh_start    smallint   NOT NULL DEFAULT 8,
  ADD COLUMN IF NOT EXISTS bh_end      smallint   NOT NULL DEFAULT 19,
  ADD COLUMN IF NOT EXISTS bh_days     smallint[] NOT NULL DEFAULT '{1,2,3,4,5}',
  ADD COLUMN IF NOT EXISTS bh_timezone text       NOT NULL DEFAULT 'America/Sao_Paulo';
-- Reverter: ALTER TABLE public.support_settings DROP COLUMN bh_start, DROP COLUMN bh_end, DROP COLUMN bh_days, DROP COLUMN bh_timezone;
