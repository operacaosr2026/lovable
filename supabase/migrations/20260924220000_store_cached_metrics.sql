-- Números da Shopify guardados por loja pra as telas só lerem, sem chamar a
-- Shopify na abertura:
--   payments_balance*  — saldo da Shopify Payments ("A receber" do Caixa e o
--                        badge "em hold" do Banco de Lojas). Atualizado pelo cron
--                        de taxas (10 em 10 min, lojas ativas) e 1x por dia
--                        (todas, inclusive pausadas).
--   board_avg_orders   — pedidos pagos por dia (últimos 7 dias), 1x por dia.
--   board_payout_days  — dias entre a venda e o depósito (últimos 3 payouts), 1x por dia.
-- Ver store-metrics.server.ts. Não-destrutivo: só colunas novas.

ALTER TABLE public.shopify_stores
  ADD COLUMN IF NOT EXISTS payments_balance          numeric,
  ADD COLUMN IF NOT EXISTS payments_balance_currency text,
  ADD COLUMN IF NOT EXISTS payments_balance_at       timestamptz,
  ADD COLUMN IF NOT EXISTS board_avg_orders          numeric,
  ADD COLUMN IF NOT EXISTS board_payout_days         numeric,
  ADD COLUMN IF NOT EXISTS board_metrics_at          timestamptz;
