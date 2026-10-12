-- Campanhas da Meta que contam como gasto de anúncio de um produto (aba
-- Vendas do produto). Só o dashboard do produto lê: o gasto é buscado ao vivo
-- na Meta e não entra no Caixa nem em nenhum outro dashboard.
-- Acesso só pelo servidor (service role): RLS ligado e sem policies.

CREATE TABLE IF NOT EXISTS public.product_ad_campaigns (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL,
  product_id    uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  shop_id       uuid NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
  ad_account_id text NOT NULL,
  campaign_id   text NOT NULL,
  campaign_name text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (product_id, campaign_id)
);
CREATE INDEX IF NOT EXISTS product_ad_campaigns_product_idx ON public.product_ad_campaigns (user_id, product_id);

ALTER TABLE public.product_ad_campaigns ENABLE ROW LEVEL SECURITY;
