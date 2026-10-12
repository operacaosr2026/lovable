-- Produto nasce com custo 0 (criado pelo quadro) e o custo de verdade só é
-- preenchido depois. Antes, esse primeiro custo valia de hoje pra frente e os
-- pedidos já vendidos ficavam com custo 0. Agora: enquanto o produto nunca teve
-- custo > 0, o primeiro custo informado vale desde sempre. Mudanças seguintes
-- continuam valendo de hoje (NY) pra frente.

CREATE OR REPLACE FUNCTION public.log_product_cost()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_from date;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.cost IS NOT DISTINCT FROM OLD.cost THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' OR NOT EXISTS (
    SELECT 1 FROM public.product_cost_history WHERE product_id = NEW.id AND cost <> 0
  ) THEN
    v_from := DATE '1900-01-01';
    DELETE FROM public.product_cost_history WHERE product_id = NEW.id AND valid_from <> v_from;
  ELSE
    v_from := (now() AT TIME ZONE 'America/New_York')::date;
  END IF;
  INSERT INTO public.product_cost_history (product_id, user_id, cost, valid_from)
  VALUES (NEW.id, NEW.user_id, COALESCE(NEW.cost, 0), v_from)
  ON CONFLICT (product_id, valid_from) DO UPDATE SET cost = EXCLUDED.cost, created_at = now();
  RETURN NEW;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.log_product_cost() FROM PUBLIC, anon, authenticated;

-- Corrige os produtos que já caíram nisso: os registros com custo 0 antes do
-- primeiro custo > 0 saem, e esse primeiro custo passa a valer desde sempre.
WITH first_cost AS (
  SELECT DISTINCT ON (product_id) product_id, id, valid_from
  FROM public.product_cost_history
  WHERE cost <> 0
  ORDER BY product_id, valid_from
)
DELETE FROM public.product_cost_history h
USING first_cost f
WHERE h.product_id = f.product_id AND h.cost = 0 AND h.valid_from < f.valid_from;

WITH first_cost AS (
  SELECT DISTINCT ON (product_id) product_id, id, valid_from
  FROM public.product_cost_history
  WHERE cost <> 0
  ORDER BY product_id, valid_from
)
UPDATE public.product_cost_history h
SET valid_from = DATE '1900-01-01'
FROM first_cost f
WHERE h.id = f.id AND f.valid_from <> DATE '1900-01-01';
