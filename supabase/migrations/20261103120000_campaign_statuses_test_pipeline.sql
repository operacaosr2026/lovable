-- Status das campanhas editáveis (nome, cor, ordem; um conjunto por
-- workspace) no lugar de Ideias/Testando/Concluído fixos + resultado
-- Validado/Inconclusivo/Rejeitado. experiments.status passa a guardar o id do
-- status do template; experiments.result fica só como histórico.
-- E a Esteira de Testes: uma lista por workspace, igual em todos os produtos,
-- com o ✓ de cada produto à parte.
-- Acesso só pelo servidor (service role): RLS ligado e sem policies.

ALTER TABLE public.experiments DROP CONSTRAINT IF EXISTS experiments_status_check;

CREATE TABLE IF NOT EXISTS public.campaign_status_templates (
  user_id    uuid PRIMARY KEY,
  statuses   jsonb NOT NULL DEFAULT '[]'::jsonb,   -- [{ id, name, color }]
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.test_pipeline_templates (
  user_id    uuid PRIMARY KEY,
  items      jsonb NOT NULL DEFAULT '[]'::jsonb,   -- [{ id, text }]
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.product_test_pipeline_checks (
  user_id    uuid NOT NULL,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  item_id    text NOT NULL,
  checked_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (product_id, item_id)
);

ALTER TABLE public.campaign_status_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.test_pipeline_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_test_pipeline_checks ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.campaign_status_templates TO service_role;
GRANT ALL ON public.test_pipeline_templates TO service_role;
GRANT ALL ON public.product_test_pipeline_checks TO service_role;
