-- Notificações › Fluxos: sequência de e-mails pra um público escolhido por
-- filtro (loja, data da compra, envio, pagamento, disputa, produto, valor).
-- mode: campanha (público tirado uma vez, ao ativar) · continuo (quem passa a
-- bater no filtro entra sozinho). steps: [{type:'email',subject,body} |
-- {type:'esperar',amount,unit:'horas'|'dias'}]. stop_rules: quando a pessoa sai
-- sozinha (respondeu, entregue, reembolsado, chargeback); cancelado sempre sai.
-- Os e-mails entram na mesma fila da aba (order_notices, 1 a cada 3 min).
-- Acesso só pelo servidor (service role): RLS ligado e sem policies.

CREATE TABLE IF NOT EXISTS public.email_flows (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id          uuid NOT NULL,
  name              text NOT NULL,
  mode              text NOT NULL DEFAULT 'campanha' CHECK (mode IN ('campanha', 'continuo')),
  status            text NOT NULL DEFAULT 'rascunho' CHECK (status IN ('rascunho', 'ativo', 'pausado', 'concluido')),
  filters           jsonb NOT NULL DEFAULT '{}'::jsonb,
  steps             jsonb NOT NULL DEFAULT '[]'::jsonb,
  stop_rules        text[] NOT NULL DEFAULT '{}',
  created_by        uuid NOT NULL,
  activated_at      timestamptz,
  last_enrolled_at  timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS email_flows_owner_idx ON public.email_flows (owner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS email_flows_active_idx ON public.email_flows (status) WHERE status = 'ativo';

DROP TRIGGER IF EXISTS email_flows_updated_at ON public.email_flows;
CREATE TRIGGER email_flows_updated_at BEFORE UPDATE ON public.email_flows
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Uma linha por pedido que entrou no fluxo. step_index = próximo passo a rodar;
-- next_at = quando roda. status: ativo · concluido · parado (stop_reason diz por quê).
CREATE TABLE IF NOT EXISTS public.email_flow_enrollments (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id     uuid NOT NULL,
  flow_id      uuid NOT NULL REFERENCES public.email_flows(id) ON DELETE CASCADE,
  order_id     uuid NOT NULL REFERENCES public.shop_orders(id) ON DELETE CASCADE,
  shop_id      uuid NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
  to_email     text NOT NULL,
  step_index   int  NOT NULL DEFAULT 0,
  next_at      timestamptz NOT NULL DEFAULT now(),
  status       text NOT NULL DEFAULT 'ativo' CHECK (status IN ('ativo', 'concluido', 'parado')),
  stop_reason  text,
  emails_sent  int  NOT NULL DEFAULT 0,
  enrolled_at  timestamptz NOT NULL DEFAULT now(),
  finished_at  timestamptz,
  UNIQUE (flow_id, order_id)
);
CREATE INDEX IF NOT EXISTS email_flow_enrollments_due_idx ON public.email_flow_enrollments (owner_id, next_at) WHERE status = 'ativo';
CREATE INDEX IF NOT EXISTS email_flow_enrollments_flow_idx ON public.email_flow_enrollments (flow_id, status);

ALTER TABLE public.email_flows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_flow_enrollments ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.email_flows TO service_role;
GRANT ALL ON public.email_flow_enrollments TO service_role;

-- E-mail da fila que veio de um fluxo (fluxo pausado / pessoa saiu: não manda).
ALTER TABLE public.order_notices
  ADD COLUMN IF NOT EXISTS flow_enrollment_id uuid REFERENCES public.email_flow_enrollments(id) ON DELETE SET NULL;

-- Reverter: ALTER TABLE public.order_notices DROP COLUMN flow_enrollment_id;
-- DROP TABLE public.email_flow_enrollments; DROP TABLE public.email_flows;
