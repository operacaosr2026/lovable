-- Funil por produto (aba Vendas do produto): sessões vêm do Custom Pixel da
-- matriz (product_viewed) e checkout iniciado do Custom Pixel das sublojas
-- (checkout_started), via /api/public/pixel. Uma linha por visitante,
-- produto, etapa e dia (fuso de Nova York) — reenvio do mesmo evento não
-- duplica. O produto do lovable é resolvido na leitura (ID publicado na loja
-- ou nome/palavra-chave), por isso guarda o ID e o título da Shopify.
-- Acesso só pelo servidor (service role): RLS ligado e sem policies.

CREATE TABLE IF NOT EXISTS public.product_funnel_events (
  id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id            uuid NOT NULL,
  shopify_store_id   uuid NOT NULL REFERENCES public.shopify_stores(id) ON DELETE CASCADE,
  step               text NOT NULL CHECK (step IN ('session', 'checkout')),
  day                date NOT NULL,
  client_id          text NOT NULL,
  shopify_product_id text NOT NULL DEFAULT '',
  title              text NOT NULL DEFAULT '',
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (shopify_store_id, step, day, client_id, shopify_product_id)
);

CREATE INDEX IF NOT EXISTS product_funnel_events_user_day_idx ON public.product_funnel_events (user_id, day);

ALTER TABLE public.product_funnel_events ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.product_funnel_events TO service_role;
