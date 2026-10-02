-- Produção de lojas (aba Produção na janela da loja do Banco de Lojas).
--  - modelo: um por dono do workspace — campos da ficha, etapas com checklist
--    e acessos que toda loja nova recebe;
--  - ficha: valores dos campos do modelo por loja ({field_id: valor});
--  - etapas: cópia das etapas do modelo na loja (mudar o modelo não mexe nas
--    lojas em produção);
--  - arquivos: tema, logo etc. no bucket privado store-production.
-- Acesso só pelo servidor (service role): RLS ligado e sem policies.

CREATE TABLE IF NOT EXISTS public.store_production_templates (
  user_id     uuid PRIMARY KEY,               -- dono do workspace
  fields      jsonb NOT NULL DEFAULT '[]'::jsonb,
  tasks       jsonb NOT NULL DEFAULT '[]'::jsonb,
  credentials jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.store_production (
  shopify_store_id uuid PRIMARY KEY REFERENCES public.shopify_stores(id) ON DELETE CASCADE,
  user_id          uuid NOT NULL,
  "values"         jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.store_production_tasks (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL,
  shopify_store_id uuid NOT NULL REFERENCES public.shopify_stores(id) ON DELETE CASCADE,
  title            text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  description      text CHECK (char_length(description) <= 5000),
  assignee_id      uuid,
  due_date         date,
  done             boolean NOT NULL DEFAULT false,
  checklist        jsonb NOT NULL DEFAULT '[]'::jsonb,
  position         integer NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS store_production_tasks_store_idx ON public.store_production_tasks (user_id, shopify_store_id);

CREATE TABLE IF NOT EXISTS public.store_production_files (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL,
  shopify_store_id uuid NOT NULL REFERENCES public.shopify_stores(id) ON DELETE CASCADE,
  name             text NOT NULL,
  path             text NOT NULL,
  size             bigint NOT NULL DEFAULT 0,
  mime             text,
  uploaded_by      uuid,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS store_production_files_store_idx ON public.store_production_files (user_id, shopify_store_id);

DROP TRIGGER IF EXISTS store_production_templates_updated_at ON public.store_production_templates;
CREATE TRIGGER store_production_templates_updated_at BEFORE UPDATE ON public.store_production_templates
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS store_production_updated_at ON public.store_production;
CREATE TRIGGER store_production_updated_at BEFORE UPDATE ON public.store_production
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS store_production_tasks_updated_at ON public.store_production_tasks;
CREATE TRIGGER store_production_tasks_updated_at BEFORE UPDATE ON public.store_production_tasks
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.store_production_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.store_production ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.store_production_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.store_production_files ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.store_production_templates TO service_role;
GRANT ALL ON public.store_production TO service_role;
GRANT ALL ON public.store_production_tasks TO service_role;
GRANT ALL ON public.store_production_files TO service_role;

-- Upload direto do navegador por URL assinada (o arquivo não passa pela
-- função da Vercel); download também por URL assinada gerada no servidor.
INSERT INTO storage.buckets (id, name, public) VALUES ('store-production', 'store-production', false)
ON CONFLICT (id) DO NOTHING;
