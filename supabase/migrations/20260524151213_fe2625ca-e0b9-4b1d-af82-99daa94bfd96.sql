ALTER TABLE public.whiteboards ADD COLUMN project_id uuid REFERENCES public.projects(id) ON DELETE CASCADE;
CREATE INDEX idx_whiteboards_project_id ON public.whiteboards(project_id);