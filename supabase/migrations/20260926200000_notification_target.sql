-- Aviso com destinatário: quando target_user_id está preenchido, só essa pessoa
-- vê o aviso no sino (ex.: "Rodrigo concluiu a tarefa X" vai só pra quem criou
-- a tarefa). Avisos sem destinatário continuam pra equipe toda.
ALTER TABLE public.app_notifications ADD COLUMN IF NOT EXISTS target_user_id uuid;
