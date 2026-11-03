-- Opções de "O que está testando" das campanhas editáveis (um conjunto por
-- workspace) no lugar da lista fixa. experiments.kind passa a guardar o id da
-- opção; os ids antigos (creative, campaign, ...) continuam valendo.
-- Acesso só pelo servidor (service role): RLS ligado e sem policies.

ALTER TABLE public.experiments DROP CONSTRAINT IF EXISTS experiments_kind_check;

CREATE TABLE IF NOT EXISTS public.campaign_kind_templates (
  user_id    uuid PRIMARY KEY,
  kinds      jsonb NOT NULL DEFAULT '[]'::jsonb,   -- [{ id, name }]
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.campaign_kind_templates ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.campaign_kind_templates TO service_role;
