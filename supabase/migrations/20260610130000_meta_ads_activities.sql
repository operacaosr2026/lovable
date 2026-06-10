
-- Meta Ads: track ad account changes (activities) into a Diário page

ALTER TABLE public.meta_ads_integrations
  ADD COLUMN journal_page_id uuid REFERENCES public.journal_pages(id) ON DELETE SET NULL,
  ADD COLUMN last_activities_sync_at timestamptz;
