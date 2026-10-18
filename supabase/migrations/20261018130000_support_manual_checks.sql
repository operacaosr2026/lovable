-- Prova semanal do manual do Atendimento: toda segunda, ~15 e-mails que a equipe
-- respondeu na semana ganham um rascunho às cegas (com o manual) e a comparação
-- com a resposta real. Uma linha por e-mail testado.
-- status: rascunho (lote do rascunho enviado) → comparar → comparando (lote da
-- comparação enviado) → ok | erro.
CREATE TABLE IF NOT EXISTS public.support_manual_checks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  week date NOT NULL,
  message_id uuid NOT NULL REFERENCES public.support_messages(id) ON DELETE CASCADE,
  reply_id uuid,
  tags text[] NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'rascunho',
  rascunho text,
  semelhanca text,
  o_que_mudou text,
  licoes text[] NOT NULL DEFAULT '{}',
  erro text,
  created_at timestamptz NOT NULL DEFAULT now(),
  evaluated_at timestamptz,
  UNIQUE (owner_id, week, message_id)
);
CREATE INDEX IF NOT EXISTS support_manual_checks_owner_week_idx ON public.support_manual_checks (owner_id, week DESC);
ALTER TABLE public.support_manual_checks ENABLE ROW LEVEL SECURITY;
-- Sem policy: só o servidor (service role) lê e grava.
