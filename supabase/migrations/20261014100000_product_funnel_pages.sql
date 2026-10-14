-- Páginas do PageFly da matriz (link /apps/pagefly?id=...) de cada produto,
-- pro funil por produto saber de qual produto é a sessão — a URL não traz o
-- produto. Cadastradas no card Funil de conversão. Um produto pode ter várias
-- páginas; cada página é de um produto só.
-- Acesso só pelo servidor (service role): RLS ligado e sem policies.

CREATE TABLE IF NOT EXISTS public.product_funnel_pages (
  user_id         uuid NOT NULL,
  pagefly_page_id text NOT NULL,
  product_id      uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, pagefly_page_id)
);

CREATE INDEX IF NOT EXISTS product_funnel_pages_product_idx ON public.product_funnel_pages (product_id);

ALTER TABLE public.product_funnel_pages ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.product_funnel_pages TO service_role;
