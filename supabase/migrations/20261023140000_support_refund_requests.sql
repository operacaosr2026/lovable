-- Atendimento › Pedidos › Reembolsar: reembolso pedido pela equipe e aprovado
-- pelo dono do workspace (mesmo fluxo da troca). Aprovado → refundCreate na
-- Shopify, sem devolver ao estoque.
-- mode: total (pedido inteiro + frete), itens (line_items + frete opcional) ou
-- valor (amount digitado, sem itens). amount = valor previsto ao pedir.
-- line_items: [{ line_item_id, title, variant_title, quantity }]
-- Acesso só pelo servidor (service role): RLS ligado e sem policies.

CREATE TABLE IF NOT EXISTS public.support_refund_requests (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id         uuid NOT NULL,
  requested_by     uuid NOT NULL,
  shop_id          uuid NOT NULL,
  conversation_id  uuid,
  order_id         uuid NOT NULL REFERENCES public.shop_orders(id) ON DELETE CASCADE,
  order_number     text,
  customer_email   text,
  customer_name    text,
  mode             text NOT NULL CHECK (mode IN ('total', 'itens', 'valor')),
  line_items       jsonb NOT NULL DEFAULT '[]'::jsonb,
  include_shipping boolean NOT NULL DEFAULT false,
  amount           numeric(12,2) NOT NULL CHECK (amount > 0),
  currency         text NOT NULL DEFAULT 'USD',
  notify_customer  boolean NOT NULL DEFAULT false,
  note             text,
  status           text NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente', 'gerando', 'aprovado', 'recusado', 'erro')),
  decided_by       uuid,
  decided_at       timestamptz,
  reject_reason    text,
  refund_id        text,
  refunded_amount  numeric(12,2),
  error            text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS support_refund_requests_owner_status_idx ON public.support_refund_requests (owner_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS support_refund_requests_order_idx ON public.support_refund_requests (order_id);

DROP TRIGGER IF EXISTS support_refund_requests_updated_at ON public.support_refund_requests;
CREATE TRIGGER support_refund_requests_updated_at BEFORE UPDATE ON public.support_refund_requests
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.support_refund_requests ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.support_refund_requests TO service_role;
