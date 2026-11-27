-- Planejamento pronto: plano montado a partir de uma data sazonal (natal-2026)
-- ou de um diagnóstico (diag:reembolso:2026-T4) — plan_key evita montar duas vezes.
-- Iniciativa ganha uma nota (o "como fazer" já mastigado).
-- Resultado-chave pode ser medido sozinho pelo sistema (metric + janela).
ALTER TABLE public.strategy_objectives ADD COLUMN IF NOT EXISTS plan_key text;
CREATE UNIQUE INDEX IF NOT EXISTS strategy_objectives_plan_key_uq ON public.strategy_objectives (user_id, plan_key) WHERE plan_key IS NOT NULL;
ALTER TABLE public.strategy_initiatives ADD COLUMN IF NOT EXISTS notes text;
ALTER TABLE public.strategy_key_results
  ADD COLUMN IF NOT EXISTS metric text,       -- revenue | orders | refund_rate | repeat_rate | delivery_days
  ADD COLUMN IF NOT EXISTS metric_from date,
  ADD COLUMN IF NOT EXISTS metric_to date;
