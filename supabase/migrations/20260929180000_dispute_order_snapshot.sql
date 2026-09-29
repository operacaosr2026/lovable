-- Aba Chargebacks: dados do pedido de uma disputa cujo pedido não está em
-- shop_orders (feito antes da loja entrar no sistema). Buscados na Shopify e
-- guardados SÓ aqui — não entram em pedidos, lucro, caixa nem em nenhuma conta.
-- {unavailable:true} = Shopify não devolveu (pedido > 60 dias sem read_all_orders);
-- tenta de novo depois de 1 dia.
ALTER TABLE public.shop_order_disputes
  ADD COLUMN IF NOT EXISTS order_snapshot    jsonb,
  ADD COLUMN IF NOT EXISTS order_snapshot_at timestamptz;
-- Reverter: ALTER TABLE public.shop_order_disputes DROP COLUMN order_snapshot, DROP COLUMN order_snapshot_at;
