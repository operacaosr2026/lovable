-- "Payout Shopify · previsto" (source = shopify_pending_sync) era apagado e
-- recriado em dois passos pelo cron de depósitos e pelo botão Sincronizar:
-- duas rodadas ao mesmo tempo podiam duplicar o previsto, e uma falha entre
-- apagar e inserir deixava o Caixa sem previsto até a próxima rodada. Agora é
-- uma transação só, com trava por loja.
CREATE OR REPLACE FUNCTION public.replace_pending_payouts(p_user_id uuid, p_shop_id uuid, p_rows jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('pending_payouts:' || p_shop_id::text));
  DELETE FROM public.shop_cash_entries
  WHERE user_id = p_user_id AND shop_id = p_shop_id AND source = 'shopify_pending_sync';
  INSERT INTO public.shop_cash_entries (user_id, shop_id, kind, amount, date, category, description, source)
  SELECT p_user_id, p_shop_id, 'income', (r->>'amount')::numeric, (r->>'date')::date,
         r->>'category', r->>'description', 'shopify_pending_sync'
  FROM jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) r;
END;
$$;

-- Só o servidor (service role) chama.
REVOKE EXECUTE ON FUNCTION public.replace_pending_payouts(uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.replace_pending_payouts(uuid, uuid, jsonb) TO service_role;
