-- Correções P3 da auditoria (audit-reports/RELATORIO_FINAL.md).

-- BUG-026 / BUG-016: limite de tentativas das rotas públicas (busca de pedido,
-- pixel). Antes era "conta e depois insere" em duas chamadas: rajadas paralelas
-- passavam do limite. Agora conta + registra numa transação, com trava por IP.
CREATE OR REPLACE FUNCTION public.public_rate_limit_hit(p_bucket text, p_ip text, p_max integer, p_window_min integer)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  n integer;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('rate_limit:' || p_bucket || ':' || p_ip));
  SELECT count(*) INTO n FROM public.public_rate_limits
  WHERE bucket = p_bucket AND ip = p_ip AND at > now() - make_interval(mins => p_window_min);
  IF n >= p_max THEN RETURN false; END IF;
  INSERT INTO public.public_rate_limits (bucket, ip) VALUES (p_bucket, p_ip);
  -- Limpeza do que passou de 1 dia (de vez em quando, não a cada chamada).
  IF random() < 0.02 THEN
    DELETE FROM public.public_rate_limits WHERE at < now() - interval '1 day';
  END IF;
  RETURN true;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.public_rate_limit_hit(text, text, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.public_rate_limit_hit(text, text, integer, integer) TO service_role;

-- BUG-021: permissões do membro eram apagadas e reinseridas em duas chamadas —
-- se a 2ª falhasse, o membro ficava sem acesso nenhum. Agora numa transação.
-- SECURITY INVOKER: as regras de member_permissions (owner_id = auth.uid()) valem.
CREATE OR REPLACE FUNCTION public.replace_member_permissions(p_member uuid, p_perms jsonb)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
BEGIN
  DELETE FROM public.member_permissions WHERE owner_id = auth.uid() AND member_id = p_member;
  INSERT INTO public.member_permissions (owner_id, member_id, section, resource_id)
  SELECT auth.uid(), p_member, p->>'section', NULLIF(p->>'resource_id', '')::uuid
  FROM jsonb_array_elements(coalesce(p_perms, '[]'::jsonb)) p;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.replace_member_permissions(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.replace_member_permissions(uuid, jsonb) TO authenticated;

-- BUG-024: quando o aviso ao cliente entrou em "enviando" (o sino avisa se
-- ficar preso).
ALTER TABLE public.order_notices ADD COLUMN IF NOT EXISTS sending_at timestamptz;

-- BUG-018: resíduo de ponto flutuante gravado (2502.4000000000005). Só mexe no
-- que difere dos centavos por menos de 0,000001 — nenhum valor real muda.
UPDATE public.shop_cash_entries
SET amount = round(amount, 2)
WHERE amount <> round(amount, 2) AND abs(amount - round(amount, 2)) < 0.000001;
