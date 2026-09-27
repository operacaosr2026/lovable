-- Atendimento > Configurações > Metas: tempos-alvo dos cards do KPI (minutos).
ALTER TABLE public.support_settings
  ADD COLUMN IF NOT EXISTS goal_first_response_min integer NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS goal_resolution_min integer NOT NULL DEFAULT 360;
