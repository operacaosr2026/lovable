-- IA em lote (Batch API da Anthropic, metade do preço): cada lote enviado fica
-- aqui até a resposta voltar (ver ai-batch.server.ts). items = o que é preciso
-- pra aplicar o resultado de cada pedido do lote (por custom_id).
-- kind: support_eval | support_playbook | consultant
-- status: processando | concluido | erro
CREATE TABLE IF NOT EXISTS public.ai_batches (
  id          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  owner_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind        text NOT NULL,
  batch_id    text NOT NULL UNIQUE,
  items       jsonb NOT NULL DEFAULT '{}'::jsonb,
  status      text NOT NULL DEFAULT 'processando',
  error       text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  done_at     timestamptz
);
CREATE INDEX IF NOT EXISTS ai_batches_pending ON public.ai_batches (kind, status);

-- Só o servidor (service role) lê e grava.
ALTER TABLE public.ai_batches ENABLE ROW LEVEL SECURITY;

-- Reverter:
-- DROP TABLE public.ai_batches;
