-- Aba Cadastro do produto fundida com Informações: Nome, Custo, Status e
-- Palavras-chave continuam colunas de products (fixos). Nicho, Fornecedor,
-- Preço de venda e Descrição viram campos da ficha (product_production_templates)
-- e os valores preenchidos são copiados pra product_production.values. As
-- colunas antigas ficam no banco, sem uso na tela.

-- 1. Campos na ficha de cada dono. Quem nunca salvou a ficha recebe a padrão
--    (DEFAULT_PRODUCT_FIELDS em store-production.server.ts); quem já tem
--    ganha só os que faltam (pelo id ou pelo nome).
WITH new_fields AS (
  SELECT * FROM (VALUES
    (1, '{"id":"nicho","label":"Nicho","type":"text"}'::jsonb),
    (2, '{"id":"fornecedor","label":"Fornecedor","type":"text"}'::jsonb),
    (3, '{"id":"preco_venda","label":"Preço de venda","type":"currency"}'::jsonb),
    (4, '{"id":"descricao","label":"Descrição","type":"longtext"}'::jsonb)
  ) AS t(pos, field)
),
owners AS (
  SELECT DISTINCT user_id FROM public.products
),
base AS (
  SELECT o.user_id, t.fields
  FROM owners o
  LEFT JOIN public.product_production_templates t ON t.user_id = o.user_id
)
INSERT INTO public.product_production_templates (user_id, fields)
SELECT
  b.user_id,
  CASE WHEN b.fields IS NULL THEN '[
    {"id":"nicho","label":"Nicho","type":"text"},
    {"id":"fornecedor","label":"Fornecedor","type":"text"},
    {"id":"preco_venda","label":"Preço de venda","type":"currency"},
    {"id":"link_fornecedor","label":"Link do fornecedor","type":"link"},
    {"id":"link_pagina","label":"Link da página do produto","type":"link"},
    {"id":"pasta_criativos","label":"Pasta de criativos","type":"link"},
    {"id":"descricao","label":"Descrição","type":"longtext"}
  ]'::jsonb
  ELSE b.fields || COALESCE((
    SELECT jsonb_agg(n.field ORDER BY n.pos) FROM new_fields n
    WHERE NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(b.fields) e
      WHERE e->>'id' = n.field->>'id' OR lower(trim(e->>'label')) = lower(n.field->>'label')
    )
  ), '[]'::jsonb)
  END
FROM base b
ON CONFLICT (user_id) DO UPDATE SET fields = EXCLUDED.fields, updated_at = now();

-- 2. Valores do cadastro antigo. Valor que já existe na ficha não é trocado.
INSERT INTO public.product_production (product_id, user_id, "values")
SELECT p.id, p.user_id, jsonb_strip_nulls(jsonb_build_object(
  'nicho', NULLIF(trim(p.niche), ''),
  'fornecedor', NULLIF(trim(p.supplier), ''),
  'preco_venda', CASE WHEN COALESCE(p.sale_price, 0) > 0 THEN to_char(p.sale_price, 'FM9999999990.00') END,
  'descricao', NULLIF(trim(p.description), '')
))
FROM public.products p
WHERE NULLIF(trim(p.niche), '') IS NOT NULL
   OR NULLIF(trim(p.supplier), '') IS NOT NULL
   OR COALESCE(p.sale_price, 0) > 0
   OR NULLIF(trim(p.description), '') IS NOT NULL
ON CONFLICT (product_id) DO UPDATE
  SET "values" = EXCLUDED."values" || public.product_production."values", updated_at = now();
