-- Notificações:
--  - Meta Facebook / falha de pagamento: status da conta de anúncio (lido no
--    sync de gasto, a cada 10 min). 3 = UNSETTLED (pagamento pendente),
--    9 = IN_GRACE_PERIOD (em carência) → aviso no sino + push.
--  - Lucro do dia: até 3 horários (HH:MM, no fuso da pessoa) pra receber o
--    lucro de hoje até aquele momento.
ALTER TABLE public.shop_meta_ad_accounts
  ADD COLUMN IF NOT EXISTS account_status integer,
  ADD COLUMN IF NOT EXISTS account_status_at timestamptz;

ALTER TABLE public.notification_settings
  ADD COLUMN IF NOT EXISTS profit_times text[] NOT NULL DEFAULT '{}';

-- Horário do lucro com precisão de 5 min: o recálculo passa a rodar de 5 em 5.
SELECT cron.alter_job(jobid, schedule := '*/5 * * * *')
FROM cron.job WHERE jobname = 'notifications-refresh';

-- Reverter: DROP COLUMN account_status, account_status_at, profit_times;
-- schedule do notifications-refresh de volta pra '*/10 * * * *'.
