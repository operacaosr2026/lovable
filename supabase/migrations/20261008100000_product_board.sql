-- Esteira de Produtos (modo padrão da página Produtos). As colunas SÃO os
-- status do produto, editáveis como no Banco de Lojas: criar, renomear,
-- reordenar, colorir e excluir. Começam com os 5 status fixos de antes e cada
-- produto entra na coluna do status que tinha (products.status fica só como
-- histórico). Acesso só pelo servidor (service role).

CREATE TABLE IF NOT EXISTS public.product_board_columns (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL,                -- dono do workspace
  name       text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 60),
  position   integer NOT NULL DEFAULT 0,
  color      text,                         -- chave de BOARD_COLUMN_COLORS; NULL = automática pelo nome
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS product_board_columns_user_idx ON public.product_board_columns (user_id, position);

DROP TRIGGER IF EXISTS product_board_columns_updated_at ON public.product_board_columns;
CREATE TRIGGER product_board_columns_updated_at BEFORE UPDATE ON public.product_board_columns
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.product_board_columns ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.product_board_columns TO service_role;

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS board_column_id uuid REFERENCES public.product_board_columns(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS board_position integer NOT NULL DEFAULT 0;

-- Status fixos de antes viram colunas (só os que faltam, pra poder rodar de novo).
INSERT INTO public.product_board_columns (user_id, name, position, color)
SELECT o.user_id, s.name, s.position, s.color
FROM (SELECT DISTINCT user_id FROM public.products) o
CROSS JOIN (VALUES
  ('Ativo', 0, 'emerald'), ('Teste', 1, 'blue'), ('Escala', 2, 'amber'),
  ('Pausado', 3, 'orange'), ('Arquivado', 4, 'slate')
) AS s(name, position, color)
WHERE NOT EXISTS (
  SELECT 1 FROM public.product_board_columns c WHERE c.user_id = o.user_id AND lower(c.name) = lower(s.name)
);

UPDATE public.products p
SET board_column_id = c.id
FROM public.product_board_columns c
WHERE p.board_column_id IS NULL
  AND c.user_id = p.user_id
  AND lower(c.name) = CASE WHEN p.status IN ('ativo', 'teste', 'escala', 'pausado', 'arquivado') THEN p.status ELSE 'ativo' END;
