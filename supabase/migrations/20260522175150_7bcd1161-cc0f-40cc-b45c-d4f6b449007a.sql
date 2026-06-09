ALTER TABLE public.journal_pages
  ADD COLUMN IF NOT EXISTS is_favorite boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS last_opened_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_journal_pages_user_favorite
  ON public.journal_pages (user_id, is_favorite) WHERE is_favorite = true;

CREATE INDEX IF NOT EXISTS idx_journal_pages_user_recent
  ON public.journal_pages (user_id, last_opened_at DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS idx_journal_pages_parent
  ON public.journal_pages (user_id, parent_id, position);