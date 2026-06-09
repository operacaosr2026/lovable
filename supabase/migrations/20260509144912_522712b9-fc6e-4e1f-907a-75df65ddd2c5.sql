
-- PROJECTS
CREATE TABLE public.projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  name text NOT NULL,
  description text,
  category text NOT NULL DEFAULT 'outros',
  status text NOT NULL DEFAULT 'planejando',
  priority text NOT NULL DEFAULT 'media',
  due_date date,
  color text NOT NULL DEFAULT 'oklch(0.6 0.22 285)',
  archived boolean NOT NULL DEFAULT false,
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own projects all" ON public.projects FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER projects_set_updated_at
  BEFORE UPDATE ON public.projects FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- PROJECT TASKS
CREATE TABLE public.project_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  parent_task_id uuid REFERENCES public.project_tasks(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  status text NOT NULL DEFAULT 'todo',
  checklist jsonb NOT NULL DEFAULT '[]'::jsonb,
  due_at timestamptz,
  recurrence_frequency text,
  recurrence_weekdays integer[] NOT NULL DEFAULT '{}',
  recurrence_time text,
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.project_tasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own project_tasks all" ON public.project_tasks FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX idx_project_tasks_project ON public.project_tasks(project_id);
CREATE TRIGGER project_tasks_set_updated_at
  BEFORE UPDATE ON public.project_tasks FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- PROJECT NOTES
CREATE TABLE public.project_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  content text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.project_notes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own project_notes all" ON public.project_notes FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX idx_project_notes_project ON public.project_notes(project_id);
CREATE TRIGGER project_notes_set_updated_at
  BEFORE UPDATE ON public.project_notes FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- PROJECT ATTACHMENTS
CREATE TABLE public.project_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  file_name text NOT NULL,
  file_path text NOT NULL,
  mime_type text,
  size_bytes bigint,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.project_attachments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own project_attachments all" ON public.project_attachments FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX idx_project_attachments_project ON public.project_attachments(project_id);

-- STORAGE BUCKET
INSERT INTO storage.buckets (id, name, public) VALUES ('project-attachments', 'project-attachments', false)
  ON CONFLICT (id) DO NOTHING;

CREATE POLICY "own project files select" ON storage.objects FOR SELECT
  USING (bucket_id = 'project-attachments' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "own project files insert" ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'project-attachments' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "own project files update" ON storage.objects FOR UPDATE
  USING (bucket_id = 'project-attachments' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "own project files delete" ON storage.objects FOR DELETE
  USING (bucket_id = 'project-attachments' AND auth.uid()::text = (storage.foldername(name))[1]);
