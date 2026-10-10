-- Aba "Página" do produto: dados pra gerar o arquivo .pagefly (modelo PG de
-- Vendas 2) — imagens do carrossel e finais (da aba Imagens), imagens de
-- depoimentos enviadas na própria aba (bucket store-production em
-- {dono}/product-pages/{produto}/...), textos, handle do botão e os links do
-- CDN da Shopify das imagens já enviadas (pra não reenviar). Tudo em data.
-- Acesso só pelo servidor (service role): RLS ligado e sem policies.

CREATE TABLE IF NOT EXISTS public.product_pages (
  product_id uuid PRIMARY KEY REFERENCES public.products(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL,
  data       jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS product_pages_updated_at ON public.product_pages;
CREATE TRIGGER product_pages_updated_at BEFORE UPDATE ON public.product_pages
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.product_pages ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.product_pages TO service_role;
