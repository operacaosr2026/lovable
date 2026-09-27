-- Atendimento: caixa de e-mail do Zoho Mail dentro do sistema.
--
-- zoho_mail_accounts   → a conta conectada (1 por workspace) e os tokens OAuth.
-- zoho_oauth_states    → "state" de uso único do fluxo OAuth (expira em 15 min).
-- support_messages     → espelho dos e-mails (cabeçalho/resumo; o corpo é buscado
--                        no Zoho na 1ª vez que a conversa é aberta e fica guardado).
-- support_conversations→ um card por cliente (e-mail do cliente), com status,
--                        favorito, tags e nota interna — o que é só nosso e não
--                        existe no Zoho.
-- Tudo só pelo servidor (service role): RLS ligado e sem policy.

CREATE TABLE IF NOT EXISTS public.zoho_mail_accounts (
  owner_id               uuid PRIMARY KEY,
  client_id              text NOT NULL,
  client_secret          text NOT NULL,
  refresh_token          text,
  access_token           text,
  access_token_expires_at timestamptz,
  accounts_server        text NOT NULL DEFAULT 'https://accounts.zoho.com',
  mail_api_base          text NOT NULL DEFAULT 'https://mail.zoho.com',
  account_id             text,
  email                  text,
  display_name           text,
  inbox_folder_id        text,
  sent_folder_id         text,
  last_sync_at           timestamptz,
  last_sync_error        text,
  connected_at           timestamptz,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.zoho_mail_accounts ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.zoho_oauth_states (
  state         text PRIMARY KEY,
  owner_id      uuid NOT NULL,
  client_id     text NOT NULL,
  client_secret text NOT NULL,
  redirect_uri  text NOT NULL,
  expires_at    timestamptz NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.zoho_oauth_states ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.support_conversations (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id         uuid NOT NULL,
  customer_email   text NOT NULL,          -- sempre minúsculo
  customer_name    text,
  subject          text,                   -- assunto do e-mail mais recente
  summary          text,                   -- trecho do e-mail mais recente
  last_message_at  timestamptz,
  last_inbound_at  timestamptz,
  last_outbound_at timestamptz,
  message_count    integer NOT NULL DEFAULT 0,
  unread_count     integer NOT NULL DEFAULT 0,
  -- em_atendimento = bola com a gente; aguardando_cliente = respondemos;
  -- resolvido = fechado (volta pra em_atendimento se o cliente escrever de novo).
  status           text NOT NULL DEFAULT 'em_atendimento'
                   CHECK (status IN ('em_atendimento', 'aguardando_cliente', 'resolvido')),
  resolved_at      timestamptz,
  favorite         boolean NOT NULL DEFAULT false,
  tags             text[] NOT NULL DEFAULT '{}',
  note             text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, customer_email)
);
CREATE INDEX IF NOT EXISTS support_conversations_owner_last_idx
  ON public.support_conversations (owner_id, last_message_at DESC);
ALTER TABLE public.support_conversations ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.support_messages (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id         uuid NOT NULL,
  conversation_id  uuid NOT NULL REFERENCES public.support_conversations(id) ON DELETE CASCADE,
  message_id       text NOT NULL,          -- id do Zoho
  folder_id        text NOT NULL,
  thread_id        text,
  direction        text NOT NULL CHECK (direction IN ('in', 'out')),
  from_email       text,
  from_name        text,
  to_emails        text,
  subject          text,
  summary          text,
  sent_at          timestamptz NOT NULL,
  is_read          boolean NOT NULL DEFAULT true,
  has_attachment   boolean NOT NULL DEFAULT false,
  content_html     text,                   -- corpo, guardado na 1ª vez que abre (e-mail não muda)
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, message_id)
);
CREATE INDEX IF NOT EXISTS support_messages_conv_idx ON public.support_messages (conversation_id, sent_at);
CREATE INDEX IF NOT EXISTS support_messages_owner_sent_idx ON public.support_messages (owner_id, sent_at);
ALTER TABLE public.support_messages ENABLE ROW LEVEL SECURITY;

-- Painel do cliente: pedidos pelo e-mail do comprador (vem no payload da Shopify).
CREATE INDEX IF NOT EXISTS shop_orders_user_email_idx
  ON public.shop_orders (user_id, lower(coalesce(raw->>'email', raw->'customer'->>'email')));

CREATE OR REPLACE FUNCTION public.shop_order_ids_by_email(p_user_id uuid, p_email text)
RETURNS SETOF uuid
LANGUAGE sql STABLE
SET search_path TO 'public'
AS $$
  SELECT id FROM public.shop_orders
  WHERE user_id = p_user_id
    AND lower(coalesce(raw->>'email', raw->'customer'->>'email')) = lower(p_email)
  LIMIT 200
$$;
REVOKE EXECUTE ON FUNCTION public.shop_order_ids_by_email(uuid, text) FROM PUBLIC, anon, authenticated;

-- Permissão da aba ("atendimento"): membros começam sem acesso; o admin libera
-- em Configurações > Membros.

-- Sincroniza a caixa a cada 5 min (a tela também sincroniza quando aberta).
SELECT cron.unschedule(jobname) FROM cron.job WHERE jobname = 'zoho-mail-sync';

SELECT cron.schedule(
  'zoho-mail-sync',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url     := 'https://lojas-one.vercel.app/api/public/hooks/zoho-mail-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-api-key', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_api_key')
    ),
    body    := '{}'::jsonb
  );
  $$
);
