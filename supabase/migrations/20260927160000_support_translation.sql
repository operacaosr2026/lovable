-- Atendimento: tradução pro português de cada e-mail (botão de tradução na
-- conversa). Guardada na 1ª vez; e-mail não muda, então não traduz de novo.
ALTER TABLE public.support_messages ADD COLUMN IF NOT EXISTS content_pt text;
