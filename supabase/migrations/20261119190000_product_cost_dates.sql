-- Histórico de preços do produto com data escolhida (Card do Produto ›
-- Custo › Histórico de preços). Cada pedido usa o custo que valia na data do
-- pedido (horário de NY); products.cost guarda o custo que vale hoje.
--
-- product_cost_history_write: cria, edita ou apaga um preço e acerta
-- products.cost, tudo numa transação. Só o servidor chama (service_role),
-- depois de conferir o acesso ao produto.

-- Gatilho: se o custo novo do produto já é o que vale hoje no histórico (veio
-- do Histórico de preços), não grava outra linha "a partir de hoje".
CREATE OR REPLACE FUNCTION public.log_product_cost()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_from date;
  v_today date := (now() AT TIME ZONE 'America/New_York')::date;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.cost IS NOT DISTINCT FROM OLD.cost THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND EXISTS (
    SELECT 1 FROM (
      SELECT cost FROM public.product_cost_history
      WHERE product_id = NEW.id AND valid_from <= v_today
      ORDER BY valid_from DESC LIMIT 1
    ) h WHERE h.cost = COALESCE(NEW.cost, 0)
  ) THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' OR NOT EXISTS (
    SELECT 1 FROM public.product_cost_history WHERE product_id = NEW.id AND cost <> 0
  ) THEN
    v_from := DATE '1900-01-01';
    DELETE FROM public.product_cost_history WHERE product_id = NEW.id AND valid_from <> v_from;
  ELSE
    v_from := v_today;
  END IF;
  INSERT INTO public.product_cost_history (product_id, user_id, cost, valid_from)
  VALUES (NEW.id, NEW.user_id, COALESCE(NEW.cost, 0), v_from)
  ON CONFLICT (product_id, valid_from) DO UPDATE SET cost = EXCLUDED.cost, created_at = now();
  RETURN NEW;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.log_product_cost() FROM PUBLIC, anon, authenticated;

-- p_entry_id null = preço novo (mesma data de um que já existe: substitui).
-- p_delete = apaga p_entry_id. Devolve a data mais antiga cujos pedidos mudam
-- de custo (pra refazer a previsão do Caixa a partir dela).
CREATE OR REPLACE FUNCTION public.product_cost_history_write(
  p_product_id uuid, p_entry_id uuid, p_valid_from date, p_cost numeric, p_delete boolean DEFAULT false
)
 RETURNS date
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_start constant date := DATE '1900-01-01';
  v_today date := (now() AT TIME ZONE 'America/New_York')::date;
  v_user uuid;
  v_old_from date;
  v_affected date;
  v_current numeric;
BEGIN
  SELECT user_id INTO v_user FROM public.products WHERE id = p_product_id FOR UPDATE;
  IF v_user IS NULL THEN RAISE EXCEPTION 'Produto não encontrado'; END IF;

  -- Produto sem a linha "Desde o início" (não deveria acontecer): cria com o custo atual.
  INSERT INTO public.product_cost_history (product_id, user_id, cost, valid_from)
  SELECT p.id, p.user_id, COALESCE(p.cost, 0), v_start FROM public.products p
  WHERE p.id = p_product_id AND NOT EXISTS (
    SELECT 1 FROM public.product_cost_history WHERE product_id = p_product_id AND valid_from = v_start
  );

  IF p_entry_id IS NOT NULL THEN
    SELECT valid_from INTO v_old_from FROM public.product_cost_history
    WHERE id = p_entry_id AND product_id = p_product_id;
    IF v_old_from IS NULL THEN RAISE EXCEPTION 'Esse preço não existe mais. Atualize a página.'; END IF;
  END IF;

  IF p_delete THEN
    IF p_entry_id IS NULL THEN RAISE EXCEPTION 'Preço não informado'; END IF;
    IF v_old_from = v_start THEN RAISE EXCEPTION 'O preço "Desde o início" não pode ser apagado'; END IF;
    DELETE FROM public.product_cost_history WHERE id = p_entry_id;
    v_affected := v_old_from;
  ELSE
    IF p_cost IS NULL OR p_cost < 0 THEN RAISE EXCEPTION 'Custo inválido'; END IF;
    IF p_valid_from IS NULL THEN RAISE EXCEPTION 'Escolha a data'; END IF;
    IF p_valid_from > v_today THEN RAISE EXCEPTION 'A data não pode ser no futuro'; END IF;
    IF p_valid_from < DATE '2000-01-01' AND p_valid_from <> v_start THEN RAISE EXCEPTION 'Data inválida'; END IF;
    IF v_old_from = v_start AND p_valid_from <> v_start THEN
      RAISE EXCEPTION 'A data do preço "Desde o início" não muda';
    END IF;
    IF p_entry_id IS NULL THEN
      INSERT INTO public.product_cost_history (product_id, user_id, cost, valid_from)
      VALUES (p_product_id, v_user, p_cost, p_valid_from)
      ON CONFLICT (product_id, valid_from) DO UPDATE SET cost = EXCLUDED.cost, created_at = now();
      v_affected := p_valid_from;
    ELSE
      IF EXISTS (
        SELECT 1 FROM public.product_cost_history
        WHERE product_id = p_product_id AND valid_from = p_valid_from AND id <> p_entry_id
      ) THEN
        RAISE EXCEPTION 'Já existe um preço começando nessa data';
      END IF;
      UPDATE public.product_cost_history SET valid_from = p_valid_from, cost = p_cost, created_at = now()
      WHERE id = p_entry_id;
      v_affected := LEAST(v_old_from, p_valid_from);
    END IF;
  END IF;

  -- Custo que vale hoje → products.cost (o gatilho vê que já está no histórico e não grava de novo).
  SELECT cost INTO v_current FROM public.product_cost_history
  WHERE product_id = p_product_id AND valid_from <= v_today
  ORDER BY valid_from DESC LIMIT 1;
  UPDATE public.products SET cost = v_current WHERE id = p_product_id AND cost IS DISTINCT FROM v_current;

  RETURN v_affected;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.product_cost_history_write(uuid, uuid, date, numeric, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.product_cost_history_write(uuid, uuid, date, numeric, boolean) TO service_role;
