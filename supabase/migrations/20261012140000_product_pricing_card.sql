-- Preço de venda volta a ser fixo (quadro Precificação da aba Informações,
-- products.sale_price). O campo "Preço de venda" que tinha ido pro template
-- (id preco_venda) sai da ficha, e o valor preenchido nele volta pro produto.

UPDATE public.products p
SET sale_price = (pp."values"->>'preco_venda')::numeric
FROM public.product_production pp
WHERE pp.product_id = p.id
  AND pp."values"->>'preco_venda' ~ '^[0-9]+(\.[0-9]+)?$';

UPDATE public.product_production
SET "values" = "values" - 'preco_venda', updated_at = now()
WHERE "values" ? 'preco_venda';

UPDATE public.product_production_templates t
SET fields = COALESCE((
  SELECT jsonb_agg(e ORDER BY ord) FROM jsonb_array_elements(t.fields) WITH ORDINALITY AS x(e, ord)
  WHERE e->>'id' <> 'preco_venda'
), '[]'::jsonb), updated_at = now()
WHERE t.fields @> '[{"id":"preco_venda"}]';

UPDATE public.store_production_presets
SET "values" = "values" - 'preco_venda'
WHERE scope = 'product' AND "values" ? 'preco_venda';
