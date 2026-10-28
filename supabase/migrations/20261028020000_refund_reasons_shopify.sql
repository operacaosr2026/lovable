-- Motivo de reembolso feito direto na Shopify (sem pedido no app), escolhido
-- na lista da Análise de reembolsos. Um por reembolso da Shopify (raw.refunds[].id).
CREATE TABLE IF NOT EXISTS public.support_refund_reasons (
  owner_id   uuid NOT NULL,
  order_id   uuid NOT NULL,
  refund_id  text NOT NULL,
  reason     text NOT NULL CHECK (reason IN ('tamanho','produto_errado','defeito','nao_chegou','alfandega','arrependimento','outro')),
  set_by     uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, order_id, refund_id)
);
ALTER TABLE public.support_refund_reasons ENABLE ROW LEVEL SECURITY;

-- Alerta de produto passa a olhar a safra de vendas (pedidos vendidos na janela
-- e os reembolsos deles até hoje): janela padrão de 30 dias, não 7.
ALTER TABLE public.support_refund_alerts ALTER COLUMN window_days SET DEFAULT 30;
