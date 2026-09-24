-- Tarefa criada a partir de uma notificação do sino guarda a chave do
-- problema (app_notifications.key, ex.: "dispute:123"): evita criar duas
-- tarefas pro mesmo aviso e permite concluir a tarefa sozinha quando o
-- problema é resolvido.
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS source_key text;
CREATE INDEX IF NOT EXISTS tasks_user_source_key_idx ON public.tasks (user_id, source_key)
  WHERE source_key IS NOT NULL;
