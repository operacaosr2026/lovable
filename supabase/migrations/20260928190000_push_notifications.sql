-- Notificações no celular (Web Push) + preferências por pessoa.
--
-- push_subscriptions      → dispositivos de cada pessoa (iPhone na Tela de
--                           Início, Chrome, Android…). Vários por pessoa.
-- notification_settings   → o que cada pessoa quer receber (tipos desligados)
--                           e o Não Perturbe (só segura o push; o sino mostra).
-- push_log                → histórico dos envios (enviado / falhou / pulado).
--
-- Os tipos liberados por membro ficam em member_permissions (seções nt_*,
-- ver src/lib/notification-categories.ts). Quem já tinha o sino
-- ("notificacoes") ganha todos os tipos, pra nada mudar na troca.
-- Tudo só pelo servidor (service role): RLS ligado e sem policies.

CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL,                -- a pessoa (não o dono do workspace)
  owner_id      uuid NOT NULL,                -- workspace
  endpoint      text NOT NULL UNIQUE,
  p256dh        text NOT NULL,
  auth          text NOT NULL,
  device_label  text,                         -- "iPhone · Safari", "Windows · Chrome"
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_used_at  timestamptz,
  failure_count integer NOT NULL DEFAULT 0,
  disabled_at   timestamptz                   -- expirada/recusada pelo serviço de push
);
CREATE INDEX IF NOT EXISTS push_subscriptions_user_idx ON public.push_subscriptions (user_id) WHERE disabled_at IS NULL;
ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.notification_settings (
  user_id          uuid PRIMARY KEY,
  muted_categories text[] NOT NULL DEFAULT '{}',   -- tipos que a pessoa desligou
  dnd_enabled      boolean NOT NULL DEFAULT false,
  dnd_start        text NOT NULL DEFAULT '23:00',  -- HH:MM no fuso abaixo
  dnd_end          text NOT NULL DEFAULT '07:00',
  timezone         text NOT NULL DEFAULT 'America/Sao_Paulo',
  updated_at       timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.notification_settings ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.push_log (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id         uuid NOT NULL,
  user_id          uuid NOT NULL,
  subscription_id  uuid,
  notification_key text,                 -- key do aviso do sino ("test" no teste)
  title            text,
  status           text NOT NULL CHECK (status IN ('sent', 'failed', 'skipped')),
  error            text,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS push_log_user_idx ON public.push_log (user_id, created_at DESC);
ALTER TABLE public.push_log ENABLE ROW LEVEL SECURITY;

INSERT INTO public.member_permissions (owner_id, member_id, section, resource_id)
SELECT p.owner_id, p.member_id, c.section, NULL
FROM public.member_permissions p
CROSS JOIN (VALUES ('nt_meta'), ('nt_shopify'), ('nt_disputas'), ('nt_rastreio'), ('nt_atendimento'), ('nt_tarefas')) AS c(section)
WHERE p.section = 'notificacoes' AND p.resource_id IS NULL
ON CONFLICT DO NOTHING;

-- Reverter: DROP TABLE push_log, notification_settings, push_subscriptions;
-- DELETE FROM member_permissions WHERE section LIKE 'nt\_%';
