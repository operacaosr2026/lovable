-- Conferência da loja nova (store-policies.server.ts): até essa data o sistema
-- confere de hora em hora se a Shopify mandou a confirmação do pedido e a de
-- envio ao cliente (não dá pra ler a configuração das notificações pela API —
-- confere pelos eventos dos primeiros pedidos). NULL = nada a conferir.
ALTER TABLE public.shopify_stores
  ADD COLUMN IF NOT EXISTS setup_check_until timestamptz;
-- Reverter: ALTER TABLE public.shopify_stores DROP COLUMN setup_check_until;
