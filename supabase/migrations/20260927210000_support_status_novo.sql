-- Atendimento: status "novo" (conversa que ainda não teve resposta).
-- Novo → Em atendimento (respondemos) → Resolvido.
ALTER TABLE public.support_conversations DROP CONSTRAINT IF EXISTS support_conversations_status_check;
ALTER TABLE public.support_conversations ADD CONSTRAINT support_conversations_status_check
  CHECK (status IN ('novo', 'em_atendimento', 'resolvido'));
UPDATE public.support_conversations SET status = 'novo'
  WHERE status = 'em_atendimento' AND last_outbound_at IS NULL;
