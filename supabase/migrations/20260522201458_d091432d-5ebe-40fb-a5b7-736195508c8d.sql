
-- SOP Processes (top-level)
CREATE TABLE public.sop_processes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  name TEXT NOT NULL DEFAULT 'Novo processo',
  description TEXT,
  icon TEXT,
  color TEXT NOT NULL DEFAULT 'oklch(0.6 0.22 285)',
  is_template BOOLEAN NOT NULL DEFAULT false,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.sop_processes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own sop_processes all" ON public.sop_processes FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER trg_sop_processes_updated BEFORE UPDATE ON public.sop_processes FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Steps (canvas nodes)
CREATE TABLE public.sop_steps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  process_id UUID NOT NULL REFERENCES public.sop_processes(id) ON DELETE CASCADE,
  parent_id UUID REFERENCES public.sop_steps(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT 'Nova etapa',
  description TEXT,
  status TEXT NOT NULL DEFAULT 'todo',
  position INTEGER NOT NULL DEFAULT 0,
  x NUMERIC NOT NULL DEFAULT 0,
  y NUMERIC NOT NULL DEFAULT 0,
  color TEXT,
  checklist JSONB NOT NULL DEFAULT '[]'::jsonb,
  links JSONB NOT NULL DEFAULT '[]'::jsonb,
  media JSONB NOT NULL DEFAULT '[]'::jsonb,
  attachments JSONB NOT NULL DEFAULT '[]'::jsonb,
  assignee TEXT,
  notes TEXT,
  done_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.sop_steps ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own sop_steps all" ON public.sop_steps FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX idx_sop_steps_process ON public.sop_steps(process_id);
CREATE INDEX idx_sop_steps_parent ON public.sop_steps(parent_id);
CREATE TRIGGER trg_sop_steps_updated BEFORE UPDATE ON public.sop_steps FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Edges between steps (visual canvas connections)
CREATE TABLE public.sop_edges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  process_id UUID NOT NULL REFERENCES public.sop_processes(id) ON DELETE CASCADE,
  source_id UUID NOT NULL REFERENCES public.sop_steps(id) ON DELETE CASCADE,
  target_id UUID NOT NULL REFERENCES public.sop_steps(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.sop_edges ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own sop_edges all" ON public.sop_edges FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX idx_sop_edges_process ON public.sop_edges(process_id);

-- Comments
CREATE TABLE public.sop_step_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  step_id UUID NOT NULL REFERENCES public.sop_steps(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.sop_step_comments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own sop_step_comments all" ON public.sop_step_comments FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX idx_sop_step_comments_step ON public.sop_step_comments(step_id);
