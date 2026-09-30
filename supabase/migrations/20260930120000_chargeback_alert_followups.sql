-- Chargebacks > Alertas: pedidos reembolsados pelo Disputifier por alerta de
-- pré-chargeback (CDRN/Ethoca/RDR). Como o pedido costuma ter sido entregue, a
-- equipe contata o cliente pra tentar reaver o valor — este é o acompanhamento.
-- status: a_contatar | contatado | recuperado | sem_retorno | nao_recuperavel
CREATE TABLE IF NOT EXISTS public.chargeback_alert_followups (
  id                uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  shop_id           uuid NOT NULL,
  order_external_id text NOT NULL,
  user_id           uuid NOT NULL,
  status            text NOT NULL DEFAULT 'a_contatar',
  recovered_amount  numeric,
  note              text,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  updated_by        uuid,
  PRIMARY KEY (shop_id, order_external_id)
);
ALTER TABLE public.chargeback_alert_followups ENABLE ROW LEVEL SECURITY;
-- Sem policy: só o servidor (service role) lê e grava.
-- Reverter: DROP TABLE public.chargeback_alert_followups;
