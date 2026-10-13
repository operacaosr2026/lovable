-- Aba Notificações: e-mails manuais pros clientes de pedidos atrasados (pra
-- avisar antes que abram chargeback de "produto não recebido").
-- Mensagens (com assunto) e o histórico do que foi enviado por pedido.

CREATE TABLE IF NOT EXISTS public.order_notice_templates (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id    uuid NOT NULL,
  title       text NOT NULL,
  subject     text NOT NULL,
  body        text NOT NULL,
  position    int  NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS order_notice_templates_owner_idx ON public.order_notice_templates (owner_id);
ALTER TABLE public.order_notice_templates ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.order_notices (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id        uuid NOT NULL,
  order_id        uuid NOT NULL REFERENCES public.shop_orders(id) ON DELETE CASCADE,
  shop_id         uuid NOT NULL,
  template_id     uuid REFERENCES public.order_notice_templates(id) ON DELETE SET NULL,
  template_title  text NOT NULL,
  to_email        text NOT NULL,
  subject         text NOT NULL,
  sent_by         uuid,
  sent_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS order_notices_owner_order_idx ON public.order_notices (owner_id, order_id);
ALTER TABLE public.order_notices ENABLE ROW LEVEL SECURITY;
-- Sem policy: só o servidor (service role) lê e grava.

-- Permissão da aba: quem já manda e-mail pelo Atendimento (Caixa) ganha a aba.
INSERT INTO public.member_permissions (owner_id, member_id, section, resource_id)
SELECT DISTINCT p.owner_id, p.member_id, 'avisos_clientes', NULL::uuid
FROM public.member_permissions p
WHERE p.section = 'at_caixa'
  AND NOT EXISTS (
    SELECT 1 FROM public.member_permissions x
    WHERE x.owner_id = p.owner_id AND x.member_id = p.member_id AND x.section = 'avisos_clientes' AND x.resource_id IS NULL
  );

-- Reverter: DROP TABLE public.order_notices; DROP TABLE public.order_notice_templates;
-- DELETE FROM public.member_permissions WHERE section = 'avisos_clientes';
