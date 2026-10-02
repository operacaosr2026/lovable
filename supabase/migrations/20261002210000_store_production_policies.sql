-- Produção de lojas: políticas (reembolso, privacidade, termos, envio...) por
-- loja — texto pronto pra copiar e colar na Shopify. Substitui o campo
-- "Políticas" da ficha, que sai do modelo salvo.
CREATE TABLE IF NOT EXISTS public.store_production_policies (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL,
  shopify_store_id uuid NOT NULL REFERENCES public.shopify_stores(id) ON DELETE CASCADE,
  title            text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 100),
  content          text NOT NULL DEFAULT '' CHECK (char_length(content) <= 100000),
  position         integer NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS store_production_policies_store_idx ON public.store_production_policies (user_id, shopify_store_id);

DROP TRIGGER IF EXISTS store_production_policies_updated_at ON public.store_production_policies;
CREATE TRIGGER store_production_policies_updated_at BEFORE UPDATE ON public.store_production_policies
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.store_production_policies ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.store_production_policies TO service_role;

UPDATE public.store_production_templates
SET fields = COALESCE((
  SELECT jsonb_agg(f ORDER BY i)
  FROM jsonb_array_elements(fields) WITH ORDINALITY AS e(f, i)
  WHERE f->>'id' <> 'politicas'
), '[]'::jsonb)
WHERE fields @> '[{"id": "politicas"}]'::jsonb;
