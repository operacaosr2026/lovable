-- Atendimento > Configurações > Assinatura: texto adicionado no fim de todo
-- e-mail enviado pelo sistema. {nome} vira o nome de quem está respondendo.
-- Fica separado da conta do Zoho pra não se perder ao desconectar/reconectar.

CREATE TABLE IF NOT EXISTS public.support_settings (
  owner_id           uuid PRIMARY KEY,
  signature          text,
  signature_enabled  boolean NOT NULL DEFAULT true,
  updated_at         timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.support_settings ENABLE ROW LEVEL SECURITY;
-- Sem policy: só o servidor (service role) lê e grava.
