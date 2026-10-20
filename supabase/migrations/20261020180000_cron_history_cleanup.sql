-- Histórico do pg_cron (cron.job_run_details) nunca era apagado: desde 09/06/2026
-- acumulou 88 MB (maior tabela do banco; o order-notices-send roda a cada minuto)
-- e entrou no esgotamento do Disk IO de 20/10/2026. O app usa a própria tabela
-- cron_runs, não esta. Guarda 3 dias e limpa todo dia às 04:30 UTC.
SELECT cron.schedule(
  'cron-history-cleanup',
  '30 4 * * *',
  $$ DELETE FROM cron.job_run_details WHERE end_time < now() - interval '3 days' $$
);
