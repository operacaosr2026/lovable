-- UTMs do pedido (jornada do cliente da Shopify) guardadas depois da primeira
-- busca: não mudam depois do pedido e buscar de novo a cada consulta deixava
-- as tabelas dos Testes e o Vendas por criativo lentos.
-- Acesso só pelo servidor (service role): RLS ligado e sem policies.

CREATE TABLE IF NOT EXISTS public.shop_order_utms (
  shop_id     uuid NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
  external_id text NOT NULL,
  source      text,
  medium      text,
  campaign    text,
  content     text,
  term        text,
  fetched_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (shop_id, external_id)
);

ALTER TABLE public.shop_order_utms ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.shop_order_utms TO service_role;
