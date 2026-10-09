-- Templates de variantes (Configurações > Templates > Variantes): opções e
-- valores que se repetem nos produtos (ex.: Size com a grade de tamanhos). O
-- padrão já vem preenchido em toda ficha nova da aba "Publicar nas lojas".
-- Acesso só pelo servidor (service role): RLS ligado e sem policies.

CREATE TABLE IF NOT EXISTS public.product_variant_templates (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL,
  name       text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 100),
  options    jsonb NOT NULL DEFAULT '[]'::jsonb,   -- [{ name, values: [] }]
  is_default boolean NOT NULL DEFAULT false,
  position   integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS product_variant_templates_user_idx ON public.product_variant_templates (user_id, position);
CREATE UNIQUE INDEX IF NOT EXISTS product_variant_templates_default_idx ON public.product_variant_templates (user_id) WHERE is_default;

DROP TRIGGER IF EXISTS product_variant_templates_updated_at ON public.product_variant_templates;
CREATE TRIGGER product_variant_templates_updated_at BEFORE UPDATE ON public.product_variant_templates
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.product_variant_templates ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.product_variant_templates TO service_role;

-- Template inicial: a grade de tamanhos (feminino / masculino) já usada.
INSERT INTO public.product_variant_templates (user_id, name, options, is_default)
SELECT o.user_id, 'Tamanhos (W / M)', '[{"name": "Size", "values": [
  "4.5W / 3M", "5W / 3.5M", "5.5W / 4M", "6W / 4.5M", "6.5W / 5M", "7W / 5.5M", "8W / 6.5M", "8.5W / 7M",
  "9W / 7.5M", "9.5W / 8M", "10W / 8.5", "10.5W / 9M", "11W / 9.5M", "11.5W / 10M", "12W / 10.5M", "12.5W / 11M",
  "13W / 11.5M", "13.5W / 12M", "14W / 12.5M", "14.5W / 13M", "15W / 13.5M", "15.5W / 14M"
]}]'::jsonb, true
FROM (SELECT DISTINCT user_id FROM public.products) o
WHERE NOT EXISTS (SELECT 1 FROM public.product_variant_templates t WHERE t.user_id = o.user_id);
