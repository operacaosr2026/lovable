-- Reembolsos: motivo padronizado (src/lib/refund-reasons.ts) e os limites do
-- alerta de reembolso alto, editáveis em Atendimento › Aprovações › Análise.

ALTER TABLE public.support_refund_requests
  ADD COLUMN IF NOT EXISTS reason text
  CHECK (reason IS NULL OR reason IN ('tamanho','produto_errado','defeito','nao_chegou','alfandega','arrependimento','outro'));

-- Um por workspace. Produto: avisa quando reembolsos ÷ vendidos na janela passa
-- do limite (com um mínimo de vendas pra não disparar com 1 de 2). Pendente:
-- reembolso parado na Shopify há mais de N dias.
CREATE TABLE IF NOT EXISTS public.support_refund_alerts (
  owner_id           uuid PRIMARY KEY,
  enabled            boolean NOT NULL DEFAULT true,
  product_rate_limit numeric NOT NULL DEFAULT 10 CHECK (product_rate_limit > 0 AND product_rate_limit <= 100),
  product_min_sold   integer NOT NULL DEFAULT 5 CHECK (product_min_sold >= 1),
  window_days        integer NOT NULL DEFAULT 7 CHECK (window_days BETWEEN 1 AND 90),
  pending_days       integer NOT NULL DEFAULT 3 CHECK (pending_days BETWEEN 1 AND 60),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.support_refund_alerts ENABLE ROW LEVEL SECURITY;

-- Última checagem do alerta (roda no máximo 1x/hora, não a cada 10 min).
ALTER TABLE public.support_refund_alerts ADD COLUMN IF NOT EXISTS last_checked_at timestamptz;
