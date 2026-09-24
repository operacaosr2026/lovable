-- Prazo pra responder a disputa (chargeback/inquiry) na Shopify — vem no
-- campo evidence_due_by do endpoint de disputas. Usado pelo sino de
-- notificações pra avisar disputa "aguardando resposta" antes de vencer.
ALTER TABLE public.shop_order_disputes
  ADD COLUMN IF NOT EXISTS evidence_due_by timestamptz;
