-- Produto › Tráfego: esteiras de Criativos e de Títulos e Descrições.
-- Colunas iguais em todos os produtos (por workspace), editáveis como nas outras
-- esteiras. board = 'creatives' | 'copies'. Card sem coluna aparece na primeira.

CREATE TABLE IF NOT EXISTS public.traffic_board_columns (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL,
  board      text NOT NULL CHECK (board IN ('creatives', 'copies')),
  name       text NOT NULL,
  position   integer NOT NULL DEFAULT 0,
  color      text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS traffic_board_columns_user_idx ON public.traffic_board_columns (user_id, board, position);
ALTER TABLE public.traffic_board_columns ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.traffic_board_columns TO service_role;

ALTER TABLE public.product_creatives
  ADD COLUMN IF NOT EXISTS board_column_id uuid REFERENCES public.traffic_board_columns(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS board_position integer NOT NULL DEFAULT 0;

-- Banco de textos do produto: kind 'title' = título (headline), 'body' = descrição (a copy).
CREATE TABLE IF NOT EXISTS public.product_copies (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  kind       text NOT NULL CHECK (kind IN ('title', 'body')),
  text       text NOT NULL,
  column_id  uuid REFERENCES public.traffic_board_columns(id) ON DELETE SET NULL,
  position   integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS product_copies_product_idx ON public.product_copies (product_id, kind);
DROP TRIGGER IF EXISTS product_copies_updated_at ON public.product_copies;
CREATE TRIGGER product_copies_updated_at BEFORE UPDATE ON public.product_copies
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
ALTER TABLE public.product_copies ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.product_copies TO service_role;

-- Os textos que estavam dentro dos criativos viram itens do banco (sem repetir).
-- Na tela antiga: "Títulos" = título; "Descrições" = texto principal (a copy).
INSERT INTO public.product_copies (user_id, product_id, kind, text)
SELECT DISTINCT user_id, product_id, kind, text FROM (
  SELECT c.user_id, c.product_id, 'title' AS kind, btrim(t) AS text
    FROM public.product_creatives c, jsonb_array_elements_text(COALESCE(c.titles, '[]'::jsonb)) t
  UNION
  SELECT c.user_id, c.product_id, 'title', btrim(c.title) FROM public.product_creatives c
  UNION
  SELECT c.user_id, c.product_id, 'body', btrim(d)
    FROM public.product_creatives c, jsonb_array_elements_text(COALESCE(c.descriptions, '[]'::jsonb)) d
  UNION
  SELECT c.user_id, c.product_id, 'body', btrim(c.description) FROM public.product_creatives c
) x
WHERE text IS NOT NULL AND text <> ''
  AND NOT EXISTS (
    SELECT 1 FROM public.product_copies p WHERE p.product_id = x.product_id AND p.kind = x.kind AND p.text = x.text
  );
