-- Atendimento › Reembolsar: pedido ainda não enviado pode ser cancelado na
-- Shopify junto com o reembolso total (em vez de cancelar direto na Shopify,
-- que não registra o motivo). cancelled_at = quando o cancelamento entrou.
ALTER TABLE public.support_refund_requests
  ADD COLUMN IF NOT EXISTS cancel_order boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS order_cancelled_at timestamptz;
