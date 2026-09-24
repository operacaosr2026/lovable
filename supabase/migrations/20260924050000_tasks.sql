-- Aba "Tarefas" (menu principal, abaixo de Dashboard): tarefas do workspace
-- com área, prioridade, status, vencimento e responsável. "Atrasada" não é um
-- status gravado — é calculado na tela (vencimento < hoje e não concluída).
-- Acesso só pelo servidor (service role): RLS ligado e sem policies.
CREATE TABLE IF NOT EXISTS public.tasks (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL,              -- dono do workspace
  title        text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  description  text,
  area         text NOT NULL DEFAULT 'gestao',
  priority     text NOT NULL DEFAULT 'media' CHECK (priority IN ('baixa', 'media', 'alta')),
  status       text NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente', 'em_andamento', 'concluida')),
  due_date     date,
  assignee_id  uuid,                       -- dono ou membro do workspace
  created_by   uuid,
  completed_at timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tasks_user_status_idx ON public.tasks (user_id, status);
CREATE INDEX IF NOT EXISTS tasks_user_due_idx ON public.tasks (user_id, due_date);

DROP TRIGGER IF EXISTS tasks_updated_at ON public.tasks;
CREATE TRIGGER tasks_updated_at BEFORE UPDATE ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.tasks TO service_role;
