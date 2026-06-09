
CREATE TABLE public.journal_pages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  parent_id UUID REFERENCES public.journal_pages(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT 'Sem título',
  content TEXT NOT NULL DEFAULT '',
  icon TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_journal_pages_user ON public.journal_pages(user_id);
CREATE INDEX idx_journal_pages_parent ON public.journal_pages(parent_id);

ALTER TABLE public.journal_pages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "owner select" ON public.journal_pages FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "owner insert" ON public.journal_pages FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "owner update" ON public.journal_pages FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "owner delete" ON public.journal_pages FOR DELETE USING (auth.uid() = user_id);

CREATE TRIGGER journal_pages_updated_at
  BEFORE UPDATE ON public.journal_pages
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
