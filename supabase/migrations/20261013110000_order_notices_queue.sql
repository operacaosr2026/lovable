-- Notificações: envio em fila, 1 e-mail por minuto por workspace (o Zoho
-- limita 50–500 e-mails externos por hora e não aceita envio em rajada).
-- O texto já vai pronto pra fila (mudar a mensagem depois não muda o que
-- está esperando).

ALTER TABLE public.order_notices
  ADD COLUMN IF NOT EXISTS status    text NOT NULL DEFAULT 'enviado',   -- na_fila | enviando | enviado | erro | cancelado
  ADD COLUMN IF NOT EXISTS body      text,
  ADD COLUMN IF NOT EXISTS error     text,
  ADD COLUMN IF NOT EXISTS queued_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.order_notices ALTER COLUMN sent_at DROP NOT NULL;
ALTER TABLE public.order_notices ALTER COLUMN sent_at DROP DEFAULT;
CREATE INDEX IF NOT EXISTS order_notices_queue_idx ON public.order_notices (owner_id, queued_at) WHERE status = 'na_fila';

-- Roda a fila a cada minuto.
SELECT cron.schedule(
  'order-notices-send',
  '* * * * *',
  $$
  SELECT net.http_post(
    url     := 'https://lojas-one.vercel.app/api/public/hooks/order-notices-send',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-api-key', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_api_key')
    ),
    body    := '{}'::jsonb
  );
  $$
);

-- Reverter: SELECT cron.unschedule('order-notices-send');
