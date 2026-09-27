-- Atendimento > Configurações > Tags: lista fixa de tags sugeridas nas
-- conversas. Tag nova criada numa conversa também entra aqui.
ALTER TABLE public.support_settings
  ADD COLUMN IF NOT EXISTS tags text[] NOT NULL DEFAULT '{Reembolso,Defeito,Troca,Rastreamento}';
