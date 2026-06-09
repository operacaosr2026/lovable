
-- whiteboards
CREATE TABLE public.whiteboards (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  name TEXT NOT NULL DEFAULT 'Novo quadro',
  icon TEXT,
  color TEXT NOT NULL DEFAULT 'oklch(0.6 0.22 285)',
  is_favorite BOOLEAN NOT NULL DEFAULT false,
  position INTEGER NOT NULL DEFAULT 0,
  viewport JSONB NOT NULL DEFAULT '{"x":0,"y":0,"zoom":1}'::jsonb,
  last_opened_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.whiteboards ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own whiteboards all" ON public.whiteboards FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER whiteboards_updated_at BEFORE UPDATE ON public.whiteboards FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- whiteboard_nodes
CREATE TABLE public.whiteboard_nodes (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  board_id UUID NOT NULL REFERENCES public.whiteboards(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'note',
  x NUMERIC NOT NULL DEFAULT 0,
  y NUMERIC NOT NULL DEFAULT 0,
  width NUMERIC,
  height NUMERIC,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  parent_id UUID REFERENCES public.whiteboard_nodes(id) ON DELETE SET NULL,
  task_id UUID,
  z_index INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.whiteboard_nodes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own whiteboard_nodes all" ON public.whiteboard_nodes FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER whiteboard_nodes_updated_at BEFORE UPDATE ON public.whiteboard_nodes FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE INDEX idx_whiteboard_nodes_board ON public.whiteboard_nodes(board_id);

-- whiteboard_edges
CREATE TABLE public.whiteboard_edges (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  board_id UUID NOT NULL REFERENCES public.whiteboards(id) ON DELETE CASCADE,
  source_node_id UUID NOT NULL REFERENCES public.whiteboard_nodes(id) ON DELETE CASCADE,
  target_node_id UUID NOT NULL REFERENCES public.whiteboard_nodes(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'arrow',
  color TEXT NOT NULL DEFAULT 'oklch(0.6 0.22 285)',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.whiteboard_edges ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own whiteboard_edges all" ON public.whiteboard_edges FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX idx_whiteboard_edges_board ON public.whiteboard_edges(board_id);

-- storage bucket for whiteboard images
INSERT INTO storage.buckets (id, name, public) VALUES ('whiteboard-images', 'whiteboard-images', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "whiteboard images public read" ON storage.objects FOR SELECT USING (bucket_id = 'whiteboard-images');
CREATE POLICY "whiteboard images user insert" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'whiteboard-images' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "whiteboard images user update" ON storage.objects FOR UPDATE USING (bucket_id = 'whiteboard-images' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "whiteboard images user delete" ON storage.objects FOR DELETE USING (bucket_id = 'whiteboard-images' AND auth.uid()::text = (storage.foldername(name))[1]);
