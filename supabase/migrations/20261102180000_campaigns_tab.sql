-- Aba Campanhas do produto (substitui Diário e Testes): cada campanha é um
-- registro de experiments ligado a uma campanha da Meta, com tags, resumo
-- (campos do template em Configurações › Templates › Campanhas) e diário
-- interno. O Diário do produto continua existindo e mostra tudo.
-- Acesso só pelo servidor (service role): RLS ligado e sem policies.

ALTER TABLE public.experiments
  ADD COLUMN IF NOT EXISTS tags    text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS summary jsonb  NOT NULL DEFAULT '{}'::jsonb;   -- { field_id: texto | true/false }

-- Registro do diário de uma campanha; sem experiment_id é do produto.
ALTER TABLE public.product_diary_entries
  ADD COLUMN IF NOT EXISTS experiment_id uuid REFERENCES public.experiments(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS product_diary_entries_experiment_idx
  ON public.product_diary_entries (experiment_id, created_at DESC) WHERE experiment_id IS NOT NULL;

-- Registros automáticos da antiga aba Testes passam pro diário da campanha.
UPDATE public.product_diary_entries d
   SET experiment_id = e.id
  FROM public.experiments e
 WHERE d.experiment_id IS NULL
   AND d.user_id = e.user_id
   AND d.product_id = e.product_id
   AND (starts_with(d.content, 'Teste iniciado: ' || e.title || ' (')
        OR starts_with(d.content, 'Teste concluído: ' || e.title || ' — '));

-- Campos do resumo da campanha: um template por workspace.
CREATE TABLE IF NOT EXISTS public.campaign_summary_templates (
  user_id    uuid PRIMARY KEY,
  fields     jsonb NOT NULL DEFAULT '[]'::jsonb,   -- [{ id, label, type, options[] }]
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.campaign_summary_templates ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.campaign_summary_templates TO service_role;
