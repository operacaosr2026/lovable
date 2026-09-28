-- Eventos que viram push (venda nova, e-mail novo, meta atingida): cada
-- evento é registrado uma vez só por workspace. A chave única garante que o
-- mesmo pedido chegando 2x pelo webhook, ou a meta checada a cada 10 min,
-- avisa uma vez só (ver emitEvent em notify.server.ts).
CREATE TABLE IF NOT EXISTS public.notification_events (
  owner_id   uuid NOT NULL,
  key        text NOT NULL,          -- ex.: sale:<shop_id>:<order_id>, goal_month:2026-09
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, key)
);
ALTER TABLE public.notification_events ENABLE ROW LEVEL SECURITY;
-- Reverter: DROP TABLE public.notification_events;
