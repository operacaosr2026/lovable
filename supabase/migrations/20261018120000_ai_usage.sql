-- Gasto com IA (Anthropic) por função: cada chamada que volta grava os tokens.
-- Lote (Batch API) custa metade — batch = true.
CREATE TABLE IF NOT EXISTS public.ai_usage (
  id bigserial PRIMARY KEY,
  feature text NOT NULL,
  model text,
  input_tokens integer NOT NULL DEFAULT 0,
  output_tokens integer NOT NULL DEFAULT 0,
  cache_read_tokens integer NOT NULL DEFAULT 0,
  cache_write_tokens integer NOT NULL DEFAULT 0,
  batch boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_usage_created_idx ON public.ai_usage (created_at DESC);
ALTER TABLE public.ai_usage ENABLE ROW LEVEL SECURITY;
-- Sem policy: só o servidor (service role) lê e grava.
