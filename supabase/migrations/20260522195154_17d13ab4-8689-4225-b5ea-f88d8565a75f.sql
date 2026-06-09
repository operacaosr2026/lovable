ALTER TABLE public.journal_pages ADD COLUMN shop_id uuid NULL;
CREATE INDEX IF NOT EXISTS idx_journal_pages_user_shop ON public.journal_pages(user_id, shop_id, parent_id, position);