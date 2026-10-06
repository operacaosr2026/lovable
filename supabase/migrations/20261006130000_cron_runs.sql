-- Histórico das rotinas automáticas (cron-runs.server.ts): cada rotina grava o
-- resultado ao terminar; o sino avisa quando uma falha ou fica parada. Só o
-- servidor (service role) lê e grava. Guarda 30 dias.
CREATE TABLE IF NOT EXISTS public.cron_runs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  job text NOT NULL,
  started_at timestamptz NOT NULL,
  finished_at timestamptz NOT NULL DEFAULT now(),
  ok boolean NOT NULL,
  status integer,
  summary text
);
CREATE INDEX IF NOT EXISTS cron_runs_started_idx ON public.cron_runs (started_at DESC);
CREATE INDEX IF NOT EXISTS cron_runs_job_idx ON public.cron_runs (job, started_at DESC);
ALTER TABLE public.cron_runs ENABLE ROW LEVEL SECURITY;
