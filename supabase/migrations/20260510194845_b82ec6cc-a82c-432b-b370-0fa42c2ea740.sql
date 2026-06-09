ALTER TABLE public.product_creatives
ADD COLUMN IF NOT EXISTS texts jsonb NOT NULL DEFAULT '[]'::jsonb;