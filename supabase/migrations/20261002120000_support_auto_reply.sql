-- Atendimento: resposta automática pra e-mail com tag Rastreio (support-autoreply.server.ts).
-- auto_reply_tracking: liga/desliga (Configurações → Resposta automática); começa desligado.
-- support_messages.auto_reply: o que aconteceu com o e-mail do cliente —
-- "enviado", ou "pulado: <motivo>" (cliente já escreveu antes, fala em reembolso…).
-- Nulo = ainda não avaliado.
ALTER TABLE public.support_settings ADD COLUMN IF NOT EXISTS auto_reply_tracking boolean NOT NULL DEFAULT false;
ALTER TABLE public.support_messages ADD COLUMN IF NOT EXISTS auto_reply text;
ALTER TABLE public.support_messages ADD COLUMN IF NOT EXISTS auto_reply_at timestamptz;
ALTER TABLE public.support_messages ADD COLUMN IF NOT EXISTS auto_reply_text text;

-- Reverter:
-- ALTER TABLE public.support_settings DROP COLUMN auto_reply_tracking;
-- ALTER TABLE public.support_messages DROP COLUMN auto_reply, DROP COLUMN auto_reply_at, DROP COLUMN auto_reply_text;
