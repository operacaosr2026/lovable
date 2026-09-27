-- Atendimento: loja de cada conversa (KPI por loja). Descoberta sozinha pelos
-- pedidos do cliente (mesmo e-mail) ou pelo nº do pedido no assunto; se não
-- achar, escolhida à mão no painel do cliente (shop_manual = true: a
-- sincronização não mexe mais).

ALTER TABLE public.support_conversations
  ADD COLUMN IF NOT EXISTS shop_id uuid REFERENCES public.shops(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS shop_manual boolean NOT NULL DEFAULT false;

-- Loja do pedido mais recente de cada e-mail (e-mails em minúsculo; usa o
-- índice shop_orders_user_email_idx).
CREATE OR REPLACE FUNCTION public.shop_by_customer_emails(p_user_id uuid, p_emails text[])
RETURNS TABLE (email text, shop_id uuid)
LANGUAGE sql STABLE
SET search_path TO 'public'
AS $$
  SELECT DISTINCT ON (1) lower(coalesce(o.raw->>'email', o.raw->'customer'->>'email')), o.shop_id
  FROM public.shop_orders o
  WHERE o.user_id = p_user_id
    AND lower(coalesce(o.raw->>'email', o.raw->'customer'->>'email')) = ANY (p_emails)
  ORDER BY 1, o.created_at_shopify DESC
$$;
REVOKE EXECUTE ON FUNCTION public.shop_by_customer_emails(uuid, text[]) FROM PUBLIC, anon, authenticated;
