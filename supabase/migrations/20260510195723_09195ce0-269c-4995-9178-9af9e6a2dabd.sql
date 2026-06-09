ALTER TABLE public.product_creatives
ADD COLUMN IF NOT EXISTS name text NOT NULL DEFAULT '',
ADD COLUMN IF NOT EXISTS titles jsonb NOT NULL DEFAULT '[]'::jsonb,
ADD COLUMN IF NOT EXISTS descriptions jsonb NOT NULL DEFAULT '[]'::jsonb;