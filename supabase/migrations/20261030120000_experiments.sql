-- Aba Testes do produto (Inteligência › Testes): testes de otimização
-- (campanha, posicionamento, criativo, página, oferta) com hipótese e
-- resultado. Iniciar e concluir um teste gera registro no Diário; os
-- concluídos formam a visão Aprendizados da página Produtos.
-- Acesso só pelo servidor (service role): RLS ligado e sem policies.

CREATE TABLE IF NOT EXISTS public.experiments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL,
  product_id  uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  shop_id     uuid REFERENCES public.shopify_stores(id) ON DELETE SET NULL,
  kind        text NOT NULL CHECK (kind IN ('campaign', 'placement', 'creative', 'page', 'offer', 'other')),
  title       text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 160),
  hypothesis  text NOT NULL DEFAULT '' CHECK (char_length(hypothesis) <= 2000),
  control     text NOT NULL DEFAULT '' CHECK (char_length(control) <= 1000),
  variant     text NOT NULL DEFAULT '' CHECK (char_length(variant) <= 1000),
  metric      text NOT NULL DEFAULT 'cpa' CHECK (metric IN ('cpa', 'roas', 'ctr', 'cvr', 'aov', 'other')),
  stop_rule   text NOT NULL DEFAULT '' CHECK (char_length(stop_rule) <= 1000),
  budget      numeric(12,2),
  status      text NOT NULL DEFAULT 'idea' CHECK (status IN ('idea', 'running', 'done')),
  result      text CHECK (result IN ('won', 'lost', 'tie')),
  learning    text NOT NULL DEFAULT '' CHECK (char_length(learning) <= 4000),
  started_at  date,
  ended_at    date,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS experiments_product_idx ON public.experiments (user_id, product_id, created_at DESC);
CREATE INDEX IF NOT EXISTS experiments_done_idx ON public.experiments (user_id, ended_at DESC) WHERE status = 'done';

DROP TRIGGER IF EXISTS experiments_updated_at ON public.experiments;
CREATE TRIGGER experiments_updated_at BEFORE UPDATE ON public.experiments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.experiments ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.experiments TO service_role;
