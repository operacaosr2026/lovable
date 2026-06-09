-- 1. Add checklist column to tasks (list tasks). shop_tasks and project_tasks already have it.
ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS checklist jsonb NOT NULL DEFAULT '[]'::jsonb;

-- 2. Attachments table for list tasks
CREATE TABLE IF NOT EXISTS public.task_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  task_id uuid NOT NULL,
  file_name text NOT NULL,
  file_path text NOT NULL,
  mime_type text,
  size_bytes bigint,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.task_attachments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own task_attachments all"
  ON public.task_attachments
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS task_attachments_task_id_idx
  ON public.task_attachments(task_id);

-- 3. Private bucket for task attachments (list + shop + project share path layout)
INSERT INTO storage.buckets (id, name, public)
VALUES ('task-attachments', 'task-attachments', false)
ON CONFLICT (id) DO NOTHING;

-- Storage RLS: users access only their own folder (path: <userId>/<taskId>/<file>)
CREATE POLICY "task-attachments user can read own"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'task-attachments' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "task-attachments user can upload own"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'task-attachments' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "task-attachments user can update own"
  ON storage.objects FOR UPDATE
  USING (bucket_id = 'task-attachments' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "task-attachments user can delete own"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'task-attachments' AND auth.uid()::text = (storage.foldername(name))[1]);