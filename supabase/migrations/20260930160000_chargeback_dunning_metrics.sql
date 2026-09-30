-- Métricas da sequência de cobrança dos Alertas de chargeback.
-- Cada e-mail enviado fica registrado (quantos saíram de cada etapa), e o
-- acompanhamento guarda quando o cliente respondeu / pagou e depois de qual e-mail.
CREATE TABLE IF NOT EXISTS public.chargeback_dunning_sends (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid NOT NULL,
  shop_id           uuid NOT NULL,
  order_external_id text NOT NULL,
  step              integer NOT NULL,          -- 1 = primeiro e-mail
  subject           text,
  sent_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS chargeback_dunning_sends_user_idx ON public.chargeback_dunning_sends (user_id, sent_at);
ALTER TABLE public.chargeback_dunning_sends ENABLE ROW LEVEL SECURITY;
-- Sem policy: só o servidor (service role) lê e grava.

ALTER TABLE public.chargeback_alert_followups
  ADD COLUMN IF NOT EXISTS dunning_replied_at timestamptz,
  ADD COLUMN IF NOT EXISTS dunning_replied_step integer,   -- nº de e-mails enviados quando o cliente respondeu
  ADD COLUMN IF NOT EXISTS recovered_at timestamptz,
  ADD COLUMN IF NOT EXISTS recovered_step integer;         -- nº de e-mails enviados quando virou Recuperado (0 = sem sequência)

-- Reverter:
-- DROP TABLE public.chargeback_dunning_sends;
-- ALTER TABLE public.chargeback_alert_followups DROP COLUMN dunning_replied_at, DROP COLUMN dunning_replied_step,
--   DROP COLUMN recovered_at, DROP COLUMN recovered_step;
