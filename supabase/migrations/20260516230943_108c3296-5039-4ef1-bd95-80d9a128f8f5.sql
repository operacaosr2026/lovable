ALTER TABLE public.project_attachments
  ADD COLUMN IF NOT EXISTS task_id uuid;

CREATE INDEX IF NOT EXISTS project_attachments_task_id_idx
  ON public.project_attachments(task_id);