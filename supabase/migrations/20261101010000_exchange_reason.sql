-- Troca: motivo da mesma lista do reembolso (refund-reasons.ts), obrigatório no
-- "Gerar troca". Trocas antigas ficam sem motivo (a tela mostra de quem foi o erro).
ALTER TABLE public.support_exchange_requests ADD COLUMN IF NOT EXISTS reason text;

-- Reverter: ALTER TABLE public.support_exchange_requests DROP COLUMN reason;
