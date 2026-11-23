-- Esteira de produtos com 3 esteiras: Mineração → Produção → Validação.
-- As colunas atuais (Ativo, Teste, Escala, Pausado, Arquivado) viram a
-- Validação e continuam sendo o status do produto (products.board_column_id).
-- Mineração e Produção guardam o lugar do produto em product_pipeline_items:
-- o mesmo produto pode estar nas duas (uma coluna por esteira).

ALTER TABLE public.product_board_columns
  ADD COLUMN IF NOT EXISTS pipeline text NOT NULL DEFAULT 'validacao';

DO $$ BEGIN
  ALTER TABLE public.product_board_columns
    ADD CONSTRAINT product_board_columns_pipeline_check CHECK (pipeline IN ('mineracao', 'producao', 'validacao'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS product_board_columns_pipeline_idx
  ON public.product_board_columns (user_id, pipeline, position);

CREATE TABLE IF NOT EXISTS public.product_pipeline_items (
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  pipeline   text NOT NULL CHECK (pipeline IN ('mineracao', 'producao')),
  column_id  uuid NOT NULL REFERENCES public.product_board_columns(id) ON DELETE CASCADE,
  position   integer NOT NULL DEFAULT 0,
  user_id    uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (product_id, pipeline)
);
CREATE INDEX IF NOT EXISTS product_pipeline_items_user_idx
  ON public.product_pipeline_items (user_id, pipeline, column_id, position);

ALTER TABLE public.product_pipeline_items ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.product_pipeline_items TO service_role;
