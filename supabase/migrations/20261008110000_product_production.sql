-- Produção de produtos (aba Produção no popup do produto) — igual à das lojas
-- (store_production*), com ficha, etapas, arquivos e políticas por produto.
-- Templates: store_production_presets ganha scope ('store' | 'product'); os
-- de produto ficam numa seção própria em Configurações > Templates, com campos
-- da ficha próprios (product_production_templates).
-- Arquivos no bucket store-production em {dono}/products/{produto}/...
-- Acesso só pelo servidor (service role): RLS ligado e sem policies.

CREATE TABLE IF NOT EXISTS public.product_production_templates (
  user_id    uuid PRIMARY KEY,               -- dono do workspace
  fields     jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.product_production (
  product_id uuid PRIMARY KEY REFERENCES public.products(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL,
  "values"   jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.product_production_tasks (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL,
  product_id  uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  title       text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  description text CHECK (char_length(description) <= 5000),
  assignee_id uuid,
  due_date    date,
  done        boolean NOT NULL DEFAULT false,
  checklist   jsonb NOT NULL DEFAULT '[]'::jsonb,
  position    integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS product_production_tasks_product_idx ON public.product_production_tasks (user_id, product_id);

CREATE TABLE IF NOT EXISTS public.product_production_files (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL,
  product_id  uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  name        text NOT NULL,
  path        text NOT NULL,
  size        bigint NOT NULL DEFAULT 0,
  mime        text,
  uploaded_by uuid,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS product_production_files_product_idx ON public.product_production_files (user_id, product_id);

CREATE TABLE IF NOT EXISTS public.product_production_policies (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  title      text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 100),
  content    text NOT NULL DEFAULT '' CHECK (char_length(content) <= 100000),
  position   integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS product_production_policies_product_idx ON public.product_production_policies (user_id, product_id);

DROP TRIGGER IF EXISTS product_production_templates_updated_at ON public.product_production_templates;
CREATE TRIGGER product_production_templates_updated_at BEFORE UPDATE ON public.product_production_templates
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS product_production_updated_at ON public.product_production;
CREATE TRIGGER product_production_updated_at BEFORE UPDATE ON public.product_production
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS product_production_tasks_updated_at ON public.product_production_tasks;
CREATE TRIGGER product_production_tasks_updated_at BEFORE UPDATE ON public.product_production_tasks
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS product_production_policies_updated_at ON public.product_production_policies;
CREATE TRIGGER product_production_policies_updated_at BEFORE UPDATE ON public.product_production_policies
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.product_production_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_production ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_production_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_production_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_production_policies ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.product_production_templates TO service_role;
GRANT ALL ON public.product_production TO service_role;
GRANT ALL ON public.product_production_tasks TO service_role;
GRANT ALL ON public.product_production_files TO service_role;
GRANT ALL ON public.product_production_policies TO service_role;

-- Templates: loja ou produto. O padrão passa a ser um por tipo.
ALTER TABLE public.store_production_presets
  ADD COLUMN IF NOT EXISTS scope text NOT NULL DEFAULT 'store' CHECK (scope IN ('store', 'product'));
DROP INDEX IF EXISTS public.store_production_presets_default_idx;
CREATE UNIQUE INDEX IF NOT EXISTS store_production_presets_default_idx
  ON public.store_production_presets (user_id, scope) WHERE is_default;
