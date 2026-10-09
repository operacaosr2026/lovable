-- Publicar produto nas lojas Shopify (aba "Publicar nas lojas" no popup do
-- produto).
--  - product_shopify_listings: ficha Shopify do produto (nomes matriz/subloja,
--    descrição, imagens, preço, variantes, estoque, SEO) em data jsonb;
--  - product_shopify_publications: em qual loja o produto já foi criado (cria
--    uma vez só por loja) ou o erro da última tentativa.
-- Acesso só pelo servidor (service role): RLS ligado e sem policies.

CREATE TABLE IF NOT EXISTS public.product_shopify_listings (
  product_id uuid PRIMARY KEY REFERENCES public.products(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL,
  data       jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.product_shopify_publications (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid NOT NULL,
  product_id         uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  shopify_store_id   uuid NOT NULL REFERENCES public.shopify_stores(id) ON DELETE CASCADE,
  status             text NOT NULL CHECK (status IN ('ok', 'error')),
  shopify_product_id text,
  handle             text,
  role               text,
  error              text,
  warnings           jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (product_id, shopify_store_id)
);

DROP TRIGGER IF EXISTS product_shopify_listings_updated_at ON public.product_shopify_listings;
CREATE TRIGGER product_shopify_listings_updated_at BEFORE UPDATE ON public.product_shopify_listings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS product_shopify_publications_updated_at ON public.product_shopify_publications;
CREATE TRIGGER product_shopify_publications_updated_at BEFORE UPDATE ON public.product_shopify_publications
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.product_shopify_listings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_shopify_publications ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.product_shopify_listings TO service_role;
GRANT ALL ON public.product_shopify_publications TO service_role;
