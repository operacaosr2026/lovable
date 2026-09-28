-- Taxa de estorno: guarda também a janela anterior (90 dias antes da atual),
-- pro "vs anterior" do Dashboard ler pronto em vez de recalcular. Os pedidos
-- agora vêm contados da Shopify (ver estorno-daily.server.ts).
ALTER TABLE public.shop_order_settings
  ADD COLUMN IF NOT EXISTS chargeback_orders_prev integer,
  ADD COLUMN IF NOT EXISTS chargeback_count_prev integer;
