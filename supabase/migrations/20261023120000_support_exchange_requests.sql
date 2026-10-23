-- Atendimento › Pedidos › Gerar troca: pedido novo (mesmo cliente, outro tamanho
-- ou modelo, de graça) pedido pela equipe e aprovado pelo dono do workspace.
-- Aprovado → rascunho na Shopify com 100% de desconto, tag reenvio-empresa ou
-- reenvio-fornecedor, finalizado como pago (a Aprodrop pega pra enviar).
-- items: [{ variant_id, product_title, variant_title, sku, quantity, replaces }]
-- Acesso só pelo servidor (service role): RLS ligado e sem policies.

CREATE TABLE IF NOT EXISTS public.support_exchange_requests (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id         uuid NOT NULL,
  requested_by     uuid NOT NULL,
  shop_id          uuid NOT NULL,
  conversation_id  uuid,
  order_id         uuid NOT NULL REFERENCES public.shop_orders(id) ON DELETE CASCADE,
  order_number     text,
  customer_email   text,
  customer_name    text,
  fault            text NOT NULL CHECK (fault IN ('empresa', 'fornecedor')),
  items            jsonb NOT NULL DEFAULT '[]'::jsonb,
  note             text,
  status           text NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente', 'gerando', 'aprovado', 'recusado', 'erro')),
  decided_by       uuid,
  decided_at       timestamptz,
  reject_reason    text,
  draft_order_id   text,
  new_order_id     text,
  new_order_name   text,
  error            text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS support_exchange_requests_owner_status_idx ON public.support_exchange_requests (owner_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS support_exchange_requests_order_idx ON public.support_exchange_requests (order_id);

DROP TRIGGER IF EXISTS support_exchange_requests_updated_at ON public.support_exchange_requests;
CREATE TRIGGER support_exchange_requests_updated_at BEFORE UPDATE ON public.support_exchange_requests
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.support_exchange_requests ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.support_exchange_requests TO service_role;
