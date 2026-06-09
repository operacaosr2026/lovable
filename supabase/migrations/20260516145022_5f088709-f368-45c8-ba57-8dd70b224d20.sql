CREATE TABLE public.kanban_columns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  board_type text NOT NULL,
  board_id text NOT NULL,
  key text NOT NULL,
  label text NOT NULL,
  color text NOT NULL DEFAULT 'oklch(0.62 0.012 270)',
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, board_type, board_id, key)
);

ALTER TABLE public.kanban_columns ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own kanban_columns all" ON public.kanban_columns
  FOR ALL TO public
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_kanban_columns_board ON public.kanban_columns(user_id, board_type, board_id, position);

CREATE TRIGGER kanban_columns_updated_at
  BEFORE UPDATE ON public.kanban_columns
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();