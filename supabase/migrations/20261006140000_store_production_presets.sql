-- Produção de lojas: vários templates com nome (Configurações > Templates).
--  - store_production_templates fica só com os campos da ficha (iguais pra
--    todas as lojas);
--  - store_production_presets: cada template guarda valores dos campos,
--    etapas (com responsável) e acessos. Aplicado pelo card da loja; o marcado
--    como padrão entra sozinho em toda loja nova do quadro.
-- Acesso só pelo servidor (service role): RLS ligado e sem policies.

CREATE TABLE IF NOT EXISTS public.store_production_presets (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL,
  name        text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 100),
  is_default  boolean NOT NULL DEFAULT false,
  "values"    jsonb NOT NULL DEFAULT '{}'::jsonb,
  tasks       jsonb NOT NULL DEFAULT '[]'::jsonb,
  credentials jsonb NOT NULL DEFAULT '[]'::jsonb,
  position    integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS store_production_presets_user_idx ON public.store_production_presets (user_id, position);
CREATE UNIQUE INDEX IF NOT EXISTS store_production_presets_default_idx ON public.store_production_presets (user_id) WHERE is_default;

DROP TRIGGER IF EXISTS store_production_presets_updated_at ON public.store_production_presets;
CREATE TRIGGER store_production_presets_updated_at BEFORE UPDATE ON public.store_production_presets
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.store_production_presets ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.store_production_presets TO service_role;

-- Modelo salvo vira o template "Padrão".
INSERT INTO public.store_production_presets (user_id, name, is_default, tasks, credentials)
SELECT t.user_id, 'Padrão', true, t.tasks, t.credentials
FROM public.store_production_templates t
WHERE NOT EXISTS (SELECT 1 FROM public.store_production_presets p WHERE p.user_id = t.user_id);

-- Quem nunca salvou o modelo usava o modelo inicial do código.
INSERT INTO public.store_production_presets (user_id, name, is_default, tasks, credentials)
SELECT DISTINCT s.user_id, 'Padrão', true,
  '[{"id":"criacao","title":"Criação da Loja","description":null,"checklist":[]},
    {"id":"config_iniciais","title":"Configurações Iniciais","description":null,"checklist":[]},
    {"id":"apps","title":"Instalar Aplicativos","description":null,"checklist":[]},
    {"id":"dominio","title":"Configurar Domínio","description":null,"checklist":[]},
    {"id":"produtos","title":"Importar Produtos","description":null,"checklist":[]},
    {"id":"config_finais","title":"Configurações Finais","description":null,"checklist":[]}]'::jsonb,
  '["Aprodrop","Conta GoDaddy"]'::jsonb
FROM public.shopify_stores s
WHERE NOT EXISTS (SELECT 1 FROM public.store_production_presets p WHERE p.user_id = s.user_id);

ALTER TABLE public.store_production_templates DROP COLUMN IF EXISTS tasks;
ALTER TABLE public.store_production_templates DROP COLUMN IF EXISTS credentials;
