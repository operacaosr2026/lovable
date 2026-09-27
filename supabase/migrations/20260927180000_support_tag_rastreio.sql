-- Atendimento: tag "Rastreamento" renomeada para "Rastreio" (lista fixa,
-- padrão da coluna e conversas que já tinham a tag).
ALTER TABLE public.support_settings
  ALTER COLUMN tags SET DEFAULT '{Reembolso,Defeito,Troca,Rastreio}';
UPDATE public.support_settings SET tags = array_replace(tags, 'Rastreamento', 'Rastreio')
  WHERE 'Rastreamento' = ANY(tags);
UPDATE public.support_conversations
  SET tags = array_replace(tags, 'Rastreamento', 'Rastreio'), ai_tags = array_replace(ai_tags, 'Rastreamento', 'Rastreio')
  WHERE 'Rastreamento' = ANY(tags) OR 'Rastreamento' = ANY(ai_tags);
