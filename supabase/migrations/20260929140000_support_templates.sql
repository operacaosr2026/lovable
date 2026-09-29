-- Atendimento: mensagens salvas (respostas prontas) do workspace, escolhidas
-- no botão "Mensagens salvas" da resposta e da Nova mensagem.
CREATE TABLE IF NOT EXISTS public.support_templates (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id    uuid NOT NULL,
  title       text NOT NULL,
  body        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS support_templates_owner_idx ON public.support_templates (owner_id);
ALTER TABLE public.support_templates ENABLE ROW LEVEL SECURITY;
-- Sem policy: só o servidor (service role) lê e grava.
-- Reverter: DROP TABLE public.support_templates;
