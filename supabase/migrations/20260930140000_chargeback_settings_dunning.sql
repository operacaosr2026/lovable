-- Chargebacks > Configurações: sequência de e-mails de cobrança dos Alertas.
-- Quando um pedido reembolsado por alerta (CDRN/Ethoca/RDR) é entregue, o
-- servidor envia os e-mails da sequência pelo Atendimento (Zoho), um a um,
-- até o cliente responder, alguém mudar o status ou a sequência acabar.
-- dunning_steps: [{ "subject": text, "body": text, "days": number }]
--   days do 1º = dias depois da entrega; dos demais = dias depois do anterior.
CREATE TABLE IF NOT EXISTS public.chargeback_settings (
  id                    uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  owner_id              uuid PRIMARY KEY,
  dunning_enabled       boolean NOT NULL DEFAULT false,
  dunning_steps         jsonb NOT NULL DEFAULT '[]'::jsonb,
  dunning_final_wait_days integer NOT NULL DEFAULT 7,
  updated_at            timestamptz NOT NULL DEFAULT now(),
  updated_by            uuid
);
ALTER TABLE public.chargeback_settings ENABLE ROW LEVEL SECURITY;
-- Sem policy: só o servidor (service role) lê e grava.

-- Progresso da sequência em cada pedido.
ALTER TABLE public.chargeback_alert_followups
  ADD COLUMN IF NOT EXISTS dunning_step integer NOT NULL DEFAULT 0,          -- e-mails já enviados
  ADD COLUMN IF NOT EXISTS dunning_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS dunning_last_at timestamptz,
  ADD COLUMN IF NOT EXISTS dunning_paused boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS dunning_stop_reason text;                          -- respondeu | pausado | fim | erro: ...

-- Reverter:
-- DROP TABLE public.chargeback_settings;
-- ALTER TABLE public.chargeback_alert_followups DROP COLUMN dunning_step, DROP COLUMN dunning_started_at,
--   DROP COLUMN dunning_last_at, DROP COLUMN dunning_paused, DROP COLUMN dunning_stop_reason;
