-- Atendimento: tags automáticas com IA. Cada e-mail novo de cliente é lido uma
-- única vez (ai_checked) e recebe tags da lista fixa (support_settings.tags).
-- E-mails que já estavam no banco entram como verificados — nada do passado é
-- reprocessado. ai_tags guarda quais tags da conversa a IA pôs (mostra ✨).

ALTER TABLE public.support_messages
  ADD COLUMN IF NOT EXISTS ai_checked boolean NOT NULL DEFAULT false;
UPDATE public.support_messages SET ai_checked = true WHERE ai_checked = false;
CREATE INDEX IF NOT EXISTS support_messages_ai_pending_idx
  ON public.support_messages (owner_id, sent_at) WHERE ai_checked = false AND direction = 'in';

ALTER TABLE public.support_conversations
  ADD COLUMN IF NOT EXISTS ai_tags text[] NOT NULL DEFAULT '{}';

ALTER TABLE public.support_settings
  ADD COLUMN IF NOT EXISTS ai_tags_enabled boolean NOT NULL DEFAULT true;
