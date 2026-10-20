-- Código de rastreio trocado à mão (aba Rastreamento): o sync do 17track não
-- volta pro código da Shopify — só segue a Shopify se ela ganhar um envio novo
-- depois dessa data.
ALTER TABLE public.shop_orders ADD COLUMN IF NOT EXISTS tracking_code_manual_at timestamptz;
