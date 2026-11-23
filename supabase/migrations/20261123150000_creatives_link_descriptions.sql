-- Criativo: "Descrição" da Meta (texto abaixo do título). titles = título (headline),
-- descriptions = texto principal (copy), link_descriptions = descrição.
ALTER TABLE public.product_creatives
  ADD COLUMN IF NOT EXISTS link_descriptions jsonb NOT NULL DEFAULT '[]'::jsonb;
