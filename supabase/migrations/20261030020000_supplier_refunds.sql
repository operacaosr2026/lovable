-- Atendimento › Reembolso: reembolso que o FORNECEDOR deve pra gente por um
-- pedido (produto errado, defeito…). A equipe marca no pedido; alguém confere
-- no sistema do fornecedor e dá o OK quando ele reembolsou. Serve pra checar
-- se o fornecedor está mesmo fazendo os reembolsos pedidos.
-- status: pendente (aguardando o fornecedor) · confirmado (fornecedor reembolsou).
-- Cancelar = apagar a linha. Um pedido tem no máximo um reembolso de fornecedor.
-- Acesso só pelo servidor (service role): RLS ligado e sem policies.

CREATE TABLE IF NOT EXISTS public.supplier_refunds (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id         uuid NOT NULL,
  shop_id          uuid NOT NULL,
  order_id         uuid NOT NULL UNIQUE REFERENCES public.shop_orders(id) ON DELETE CASCADE,
  order_number     text,
  conversation_id  uuid,
  customer_name    text,
  amount           numeric(12,2) NOT NULL CHECK (amount >= 0),
  note             text,
  status           text NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente', 'confirmado')),
  requested_by     uuid NOT NULL,
  confirmed_by     uuid,
  confirmed_at     timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS supplier_refunds_owner_status_idx ON public.supplier_refunds (owner_id, status, created_at DESC);

DROP TRIGGER IF EXISTS supplier_refunds_updated_at ON public.supplier_refunds;
CREATE TRIGGER supplier_refunds_updated_at BEFORE UPDATE ON public.supplier_refunds
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.supplier_refunds ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.supplier_refunds TO service_role;
