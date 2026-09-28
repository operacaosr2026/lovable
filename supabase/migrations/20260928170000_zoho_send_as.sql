-- Atendimento: remetente escolhido ("Enviar como") e os endereços da conta.
-- Uma conta Zoho pode ter apelidos (ex.: help@ é o principal e support@ é o
-- endereço da caixa) e endereços liberados em "Enviar e-mail como".
--   send_as          → endereço pelo qual as respostas saem (escolhido em Configurações)
--   send_as_options  → endereços que a conta pode usar como remetente (sendMailDetails)
--   addresses        → todos os endereços "nossos" (pra não virar conversa de cliente)
ALTER TABLE public.zoho_mail_accounts
  ADD COLUMN IF NOT EXISTS send_as text,
  ADD COLUMN IF NOT EXISTS send_as_options text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS addresses text[] NOT NULL DEFAULT '{}';
