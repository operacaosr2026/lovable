-- Atendimento: "aguardando cliente" foi juntado a "em atendimento" (só dois
-- status agora: em atendimento e resolvido).
UPDATE public.support_conversations SET status = 'em_atendimento' WHERE status = 'aguardando_cliente';
ALTER TABLE public.support_conversations DROP CONSTRAINT IF EXISTS support_conversations_status_check;
ALTER TABLE public.support_conversations ADD CONSTRAINT support_conversations_status_check
  CHECK (status IN ('em_atendimento', 'resolvido'));
