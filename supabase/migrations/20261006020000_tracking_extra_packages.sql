-- Pedido com mais de um envio (vários códigos de rastreio na Shopify): o código
-- principal continua em tracking_number/timeline; os outros pacotes ficam aqui,
-- cada um { number, registered_17track_at, carrier, tracking_status,
-- status_key, last_event_at, last_event_label, timeline, edd_from, edd_to,
-- edd_source } — preenchido pelo sync do 17track.
ALTER TABLE public.shop_order_tracking
  ADD COLUMN IF NOT EXISTS extra_packages jsonb NOT NULL DEFAULT '[]'::jsonb;
