ALTER TABLE public.shop_meta_tokens
  ADD COLUMN IF NOT EXISTS selected_campaign_ids jsonb DEFAULT '[]'::jsonb;
