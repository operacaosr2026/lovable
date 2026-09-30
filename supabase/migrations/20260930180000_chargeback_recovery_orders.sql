-- Recuperação dos Alertas pela Shopify: um pedido rascunho "Payment for order #X"
-- (item avulso, sem envio, tag recuperacao-alerta) com link de pagamento no
-- e-mail da cobrança. Quando o cliente paga, vira pedido na loja: o sistema marca
-- Recuperado, dá o pedido como atendido na Shopify (sem rastreio) e o valor abate
-- o reembolso no lucro. Esse pedido não entra em shop_orders (nem em Pedidos,
-- Logística ou Rastreio).
ALTER TABLE public.chargeback_alert_followups
  ADD COLUMN IF NOT EXISTS recovery_draft_id text,          -- gid://shopify/DraftOrder/…
  ADD COLUMN IF NOT EXISTS recovery_invoice_url text,       -- link de pagamento (checkout da loja)
  ADD COLUMN IF NOT EXISTS recovery_order_id text,          -- gid://shopify/Order/… depois de pago
  ADD COLUMN IF NOT EXISTS recovery_order_name text,        -- #1234
  ADD COLUMN IF NOT EXISTS recovery_paid_at timestamptz,
  ADD COLUMN IF NOT EXISTS recovery_fulfilled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS recovery_error text;

-- Reverter:
-- ALTER TABLE public.chargeback_alert_followups DROP COLUMN recovery_draft_id, DROP COLUMN recovery_invoice_url,
--   DROP COLUMN recovery_order_id, DROP COLUMN recovery_order_name, DROP COLUMN recovery_paid_at,
--   DROP COLUMN recovery_fulfilled, DROP COLUMN recovery_error;
