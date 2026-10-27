-- Card de Produto ↔ produtos da Shopify (botão "Sincronizar Card"). O item do
-- pedido é do card pelo product_id da Shopify (substitui as palavras-chave).
-- Item sem product_id (produto apagado na Shopify, item avulso, app) é do card
-- pelo título exato (line_item_title: minúsculo, espaços normalizados).
-- Um card pode ter vários produtos/títulos por loja; cada um é de um card só.
-- Acesso só pelo servidor (service role): RLS ligado e sem policies.

CREATE TABLE IF NOT EXISTS public.product_shopify_links (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid NOT NULL,
  product_id         uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  shopify_store_id   uuid NOT NULL REFERENCES public.shopify_stores(id) ON DELETE CASCADE,
  shopify_product_id text,
  line_item_title    text,
  title              text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  CHECK ((shopify_product_id IS NULL) <> (line_item_title IS NULL)),
  UNIQUE (user_id, shopify_product_id),
  UNIQUE (user_id, line_item_title)
);
CREATE INDEX IF NOT EXISTS product_shopify_links_product ON public.product_shopify_links (product_id);

ALTER TABLE public.product_shopify_links ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.product_shopify_links TO service_role;

CREATE OR REPLACE FUNCTION public.normalize_line_item_title(t text) RETURNS text
  LANGUAGE sql IMMUTABLE AS $$ SELECT lower(regexp_replace(trim(COALESCE(t, '')), '\s+', ' ', 'g')) $$;

-- Títulos dos itens sem product_id nos pedidos das lojas (Sincronizar Card).
CREATE OR REPLACE FUNCTION public.loose_line_item_titles(p_user_id uuid, p_shop_ids uuid[])
RETURNS TABLE (line_item_title text, title text, orders bigint)
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT public.normalize_line_item_title(li->>'title'), max(li->>'title'), count(DISTINCT o.id)
  FROM shop_orders o
  CROSS JOIN LATERAL jsonb_array_elements(COALESCE(o.raw->'line_items', '[]'::jsonb)) li
  WHERE o.user_id = p_user_id AND o.shop_id = ANY(p_shop_ids)
    AND COALESCE(li->>'product_id', '') = '' AND public.normalize_line_item_title(li->>'title') <> ''
  GROUP BY 1
$$;
REVOKE ALL ON FUNCTION public.loose_line_item_titles(uuid, uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.loose_line_item_titles(uuid, uuid[]) TO service_role;

-- Virada: os produtos já publicados pela aba "Publicar nas lojas"…
INSERT INTO public.product_shopify_links (user_id, product_id, shopify_store_id, shopify_product_id)
SELECT DISTINCT ON (user_id, shopify_product_id) user_id, product_id, shopify_store_id, shopify_product_id
FROM public.product_shopify_publications
WHERE status = 'ok' AND shopify_product_id IS NOT NULL
ORDER BY user_id, shopify_product_id, updated_at DESC
ON CONFLICT DO NOTHING;

-- …e cada produto da Shopify (ou título de item sem produto) que aparece nos
-- pedidos vai pro card que a regra antiga escolhia (nome ou palavra-chave
-- contida no título, vence o mais longo).
WITH items AS (
  SELECT DISTINCT o.user_id, COALESCE(sos.shopify_store_id, s.shopify_store_id) AS shopify_store_id,
         NULLIF(li->>'product_id', '') AS shopify_product_id, li->>'title' AS title
  FROM public.shop_orders o
  LEFT JOIN public.shop_order_settings sos ON sos.shop_id = o.shop_id
  LEFT JOIN public.shops s ON s.id = o.shop_id
  CROSS JOIN LATERAL jsonb_array_elements(COALESCE(o.raw->'line_items', '[]'::jsonb)) li
), terms AS (
  SELECT p.id, p.user_id, lower(trim(t)) AS term
  FROM public.products p, unnest(array_prepend(p.name, p.keywords)) t
  WHERE trim(t) <> ''
), matches AS (
  SELECT i.user_id, i.shopify_store_id, i.shopify_product_id, i.title,
         public.normalize_line_item_title(i.title) AS line_item_title, t.id AS product_id, length(t.term) AS len
  FROM items i
  JOIN terms t ON t.user_id = i.user_id AND position(t.term IN lower(COALESCE(i.title, ''))) > 0
  JOIN public.shopify_stores ss ON ss.id = i.shopify_store_id
), by_id AS (
  INSERT INTO public.product_shopify_links (user_id, product_id, shopify_store_id, shopify_product_id, title)
  SELECT DISTINCT ON (user_id, shopify_product_id) user_id, product_id, shopify_store_id, shopify_product_id, title
  FROM matches
  WHERE shopify_product_id IS NOT NULL
  ORDER BY user_id, shopify_product_id, len DESC
  ON CONFLICT DO NOTHING
  RETURNING 1
)
INSERT INTO public.product_shopify_links (user_id, product_id, shopify_store_id, line_item_title, title)
SELECT DISTINCT ON (user_id, line_item_title) user_id, product_id, shopify_store_id, line_item_title, title
FROM matches
WHERE shopify_product_id IS NULL AND line_item_title <> ''
ORDER BY user_id, line_item_title, len DESC
ON CONFLICT DO NOTHING;
