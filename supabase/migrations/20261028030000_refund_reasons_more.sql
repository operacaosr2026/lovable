-- Motivos de reembolso novos: demora na entrega e possível chargeback
-- (src/lib/refund-reasons.ts).

ALTER TABLE public.support_refund_requests DROP CONSTRAINT IF EXISTS support_refund_requests_reason_check;
ALTER TABLE public.support_refund_requests ADD CONSTRAINT support_refund_requests_reason_check
  CHECK (reason IS NULL OR reason IN ('tamanho','produto_errado','defeito','nao_chegou','alfandega','demora_entrega','chargeback','arrependimento','outro'));

ALTER TABLE public.support_refund_reasons DROP CONSTRAINT IF EXISTS support_refund_reasons_reason_check;
ALTER TABLE public.support_refund_reasons ADD CONSTRAINT support_refund_reasons_reason_check
  CHECK (reason IN ('tamanho','produto_errado','defeito','nao_chegou','alfandega','demora_entrega','chargeback','arrependimento','outro'));
