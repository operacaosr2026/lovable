ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS keywords text[] NOT NULL DEFAULT '{}';
