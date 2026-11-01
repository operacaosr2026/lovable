-- Testes do produto: campanha da Meta ligada ao teste e números de base
-- (digitados à mão) pra comparar com o resultado.
ALTER TABLE public.experiments
  ADD COLUMN IF NOT EXISTS campaign_id   text,
  ADD COLUMN IF NOT EXISTS campaign_name text,
  ADD COLUMN IF NOT EXISTS baseline      jsonb NOT NULL DEFAULT '{}'::jsonb;   -- { metric_key: número }

-- Nomenclatura de campanha, conjunto e anúncio (Configurações › Templates ›
-- Nomenclatura): um template por workspace. O gerador fica no produto
-- (Anúncios › Nomenclatura).
-- Acesso só pelo servidor (service role): RLS ligado e sem policies.
CREATE TABLE IF NOT EXISTS public.naming_templates (
  user_id    uuid PRIMARY KEY,
  separator  text NOT NULL DEFAULT '_' CHECK (char_length(separator) BETWEEN 1 AND 3),
  levels     jsonb NOT NULL DEFAULT '{}'::jsonb,   -- { campaign|adset|ad: [{ id, label, options[] }] }
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.naming_templates ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.naming_templates TO service_role;
