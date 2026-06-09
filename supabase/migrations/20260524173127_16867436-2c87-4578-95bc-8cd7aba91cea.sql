ALTER TABLE public.sop_processes ADD COLUMN IF NOT EXISTS layout_type text NOT NULL DEFAULT 'horizontal';
ALTER TABLE public.sop_steps ADD COLUMN IF NOT EXISTS manual boolean NOT NULL DEFAULT false;