-- Nova esteira de produtos: Escala (depois da Validação). Funciona como
-- Mineração e Produção: o lugar do produto fica em product_pipeline_items.
ALTER TABLE public.product_board_columns DROP CONSTRAINT IF EXISTS product_board_columns_pipeline_check;
ALTER TABLE public.product_board_columns
  ADD CONSTRAINT product_board_columns_pipeline_check CHECK (pipeline IN ('mineracao', 'producao', 'validacao', 'escala'));

ALTER TABLE public.product_pipeline_items DROP CONSTRAINT IF EXISTS product_pipeline_items_pipeline_check;
ALTER TABLE public.product_pipeline_items
  ADD CONSTRAINT product_pipeline_items_pipeline_check CHECK (pipeline IN ('mineracao', 'producao', 'escala'));
