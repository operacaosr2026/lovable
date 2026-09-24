-- Central de notificações (sino no topo do menu). Cada linha é um PROBLEMA
-- identificado por `key` (ex.: "meta_token:<shop_id>"), não um evento: se o
-- mesmo problema continua, a linha é atualizada em vez de duplicar; quando o
-- problema some, `resolved_at` é preenchido e ela sai da lista; se voltar
-- depois, reabre como não lida.
-- Acesso só pelo servidor (service role): RLS ligado e sem policies.
CREATE TABLE IF NOT EXISTS public.app_notifications (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL,           -- dono do workspace
  key          text NOT NULL,
  level        text NOT NULL DEFAULT 'warning' CHECK (level IN ('info', 'warning', 'error')),
  title        text NOT NULL,
  body         text,
  link         text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  read_at      timestamptz,
  dismissed_at timestamptz,
  resolved_at  timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS app_notifications_user_key_uq
  ON public.app_notifications (user_id, key);

ALTER TABLE public.app_notifications ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.app_notifications TO service_role;
