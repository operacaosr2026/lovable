-- Concorrentes do produto (Produtos › Inteligência › Concorrentes): um quadro
-- por concorrente, com campos próprios. O quadro nasce de um template
-- (Configurações › Templates › Concorrentes), que por enquanto é só uma lista
-- de campos; depois de criado, os campos do quadro são editáveis sem mexer no
-- template.
-- Acesso só pelo servidor (service role): RLS ligado e sem policies.

CREATE TABLE IF NOT EXISTS public.competitor_templates (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL,
  name       text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 100),
  fields     jsonb NOT NULL DEFAULT '[]'::jsonb,   -- [{ id, label, type }]
  is_default boolean NOT NULL DEFAULT false,
  position   integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS competitor_templates_user_idx ON public.competitor_templates (user_id, position);
CREATE UNIQUE INDEX IF NOT EXISTS competitor_templates_default_idx ON public.competitor_templates (user_id) WHERE is_default;

DROP TRIGGER IF EXISTS competitor_templates_updated_at ON public.competitor_templates;
CREATE TRIGGER competitor_templates_updated_at BEFORE UPDATE ON public.competitor_templates
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.competitor_templates ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.competitor_templates TO service_role;

CREATE TABLE IF NOT EXISTS public.product_competitors (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  name       text NOT NULL DEFAULT '' CHECK (char_length(name) <= 160),
  fields     jsonb NOT NULL DEFAULT '[]'::jsonb,   -- [{ id, label, type }] copiados do template
  "values"   jsonb NOT NULL DEFAULT '{}'::jsonb,   -- { field_id: valor }
  position   integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS product_competitors_product_idx ON public.product_competitors (product_id, position);

DROP TRIGGER IF EXISTS product_competitors_updated_at ON public.product_competitors;
CREATE TRIGGER product_competitors_updated_at BEFORE UPDATE ON public.product_competitors
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.product_competitors ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.product_competitors TO service_role;

-- Template inicial.
INSERT INTO public.competitor_templates (user_id, name, fields, is_default)
SELECT o.user_id, 'Concorrente', '[
  {"id": "loja", "label": "Loja", "type": "link"},
  {"id": "pagina", "label": "Página do produto", "type": "link"},
  {"id": "preco", "label": "Preço", "type": "currency"},
  {"id": "biblioteca_anuncios", "label": "Biblioteca de anúncios", "type": "link"},
  {"id": "observacoes", "label": "Observações", "type": "longtext"}
]'::jsonb, true
FROM (SELECT DISTINCT user_id FROM public.products) o
WHERE NOT EXISTS (SELECT 1 FROM public.competitor_templates t WHERE t.user_id = o.user_id);
