-- Análise de fraude da Shopify por pedido (o ⚠ "Este pedido pode ser
-- fraudulento"): nível (LOW/MEDIUM/HIGH), recomendação (ACCEPT/INVESTIGATE/
-- CANCEL) e os motivos. Alimenta a aba Chargebacks (risco × chargeback/reembolso).
-- Atualizado pelo sync completo (pedidos dos últimos 3 dias).
CREATE TABLE IF NOT EXISTS public.shop_order_risks (
  shop_id           uuid NOT NULL,
  order_external_id text NOT NULL,
  user_id           uuid NOT NULL,
  order_name        text,
  order_created_at  timestamptz,
  risk_level        text,
  recommendation    text,
  facts             jsonb NOT NULL DEFAULT '[]',
  -- Status de pagamento na Shopify (REFUNDED, PARTIALLY_REFUNDED…): pedido que
  -- não está em shop_orders (antes da loja entrar no sistema) também entra na conta.
  financial_status  text,
  -- Bandeira / meio de pagamento (Visa, Mastercard, American Express, Discover,
  -- PayPal, Shop Pay Parcelado…) — card "Bandeira × chargeback".
  payment_brand     text,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (shop_id, order_external_id)
);
-- `id` só pro selectAll paginar (ele ordena por id).
ALTER TABLE public.shop_order_risks ADD COLUMN IF NOT EXISTS id uuid NOT NULL DEFAULT gen_random_uuid();
CREATE UNIQUE INDEX IF NOT EXISTS shop_order_risks_id_idx ON public.shop_order_risks (id);
CREATE INDEX IF NOT EXISTS shop_order_risks_user_idx ON public.shop_order_risks (user_id, order_created_at);
ALTER TABLE public.shop_order_risks ENABLE ROW LEVEL SECURITY;
-- Sem policy: só o servidor (service role) lê e grava.
-- Reverter: DROP TABLE public.shop_order_risks;
