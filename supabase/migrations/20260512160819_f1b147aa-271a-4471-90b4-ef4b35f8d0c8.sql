ALTER TABLE public.shops ADD COLUMN IF NOT EXISTS pipeline_stage text NOT NULL DEFAULT 'para_criar';
ALTER TABLE public.shops ADD COLUMN IF NOT EXISTS pipeline_position integer NOT NULL DEFAULT 0;