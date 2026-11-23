-- Página Concorrentes: concorrente pode ser cadastrado direto na página, sem
-- produto. Os quadros dos produtos continuam na mesma tabela.
ALTER TABLE public.product_competitors ALTER COLUMN product_id DROP NOT NULL;
CREATE INDEX IF NOT EXISTS product_competitors_user_idx ON public.product_competitors (user_id, created_at DESC);
