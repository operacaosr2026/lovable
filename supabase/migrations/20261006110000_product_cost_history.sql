-- Histórico do custo de cada produto: mudar o custo vale da data da mudança
-- (horário de NY) pra frente; pedidos antigos continuam com o custo da época
-- (costProductsFor / productCostAt em product-cost-match.ts).
--
-- Gravado por gatilho em products — qualquer caminho que mude o custo (tela,
-- servidor, SQL) entra no histórico. Mudar 2x no mesmo dia: vale a última.

CREATE TABLE IF NOT EXISTS public.product_cost_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  cost numeric NOT NULL,
  valid_from date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (product_id, valid_from)
);
CREATE INDEX IF NOT EXISTS product_cost_history_user_idx ON public.product_cost_history (user_id);

ALTER TABLE public.product_cost_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own product_cost_history select" ON public.product_cost_history
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "members read product_cost_history" ON public.product_cost_history
  FOR SELECT USING (has_workspace_access(auth.uid(), user_id, 'shops'::text, NULL::uuid));

-- Ponto de partida: o custo atual vale pra todo o passado (é o que as telas
-- já mostravam).
INSERT INTO public.product_cost_history (product_id, user_id, cost, valid_from)
SELECT id, user_id, COALESCE(cost, 0), DATE '1900-01-01' FROM public.products
ON CONFLICT (product_id, valid_from) DO NOTHING;

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
  -- Produto novo: o custo vale desde sempre (pedidos já vendidos com esse nome
  -- passam a ter custo). Mudança: de hoje (NY) pra frente.
  v_from := CASE WHEN TG_OP = 'INSERT' THEN DATE '1900-01-01'
                 ELSE (now() AT TIME ZONE 'America/New_York')::date END;
  INSERT INTO public.product_cost_history (product_id, user_id, cost, valid_from)
  VALUES (NEW.id, NEW.user_id, COALESCE(NEW.cost, 0), v_from)
  ON CONFLICT (product_id, valid_from) DO UPDATE SET cost = EXCLUDED.cost, created_at = now();
  RETURN NEW;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.log_product_cost() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS products_cost_history ON public.products;
CREATE TRIGGER products_cost_history
  AFTER INSERT OR UPDATE OF cost ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.log_product_cost();
