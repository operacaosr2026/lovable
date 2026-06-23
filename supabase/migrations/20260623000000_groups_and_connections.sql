-- ============================================================
-- Banco de Lojas + Grupos Multi-Loja
-- ============================================================

-- 1. shopify_connections — banco de lojas individual
-- Cada loja Shopify tem suas credenciais aqui.
-- Múltiplas lojas podem ser agrupadas em um "shop" (grupo).
CREATE TABLE IF NOT EXISTS public.shopify_connections (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name              text NOT NULL,
  shop_domain       text NOT NULL,
  access_token      text NOT NULL DEFAULT '',
  last_sync_at      timestamptz,
  last_sync_status  text NOT NULL DEFAULT 'never',
  last_sync_error   text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, shop_domain)
);

ALTER TABLE public.shopify_connections ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner_shopify_connections" ON public.shopify_connections
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER shopify_connections_updated_at BEFORE UPDATE ON public.shopify_connections
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 2. shop_group_stores — junction: grupo ↔ loja individual
CREATE TABLE IF NOT EXISTS public.shop_group_stores (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id       uuid NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
  connection_id uuid NOT NULL REFERENCES public.shopify_connections(id) ON DELETE CASCADE,
  role          text NOT NULL DEFAULT 'sub' CHECK (role IN ('matrix', 'sub')),
  position      integer NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (shop_id, connection_id)
);

ALTER TABLE public.shop_group_stores ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner_shop_group_stores" ON public.shop_group_stores
  FOR ALL USING (
    EXISTS (SELECT 1 FROM public.shops s WHERE s.id = shop_id AND s.user_id = auth.uid())
  );

CREATE INDEX IF NOT EXISTS idx_shop_group_stores_shop ON public.shop_group_stores (shop_id);
CREATE INDEX IF NOT EXISTS idx_shop_group_stores_conn ON public.shop_group_stores (connection_id);

-- 3. shop_orders: add connection_id to saber de qual loja veio cada pedido
ALTER TABLE public.shop_orders
  ADD COLUMN IF NOT EXISTS connection_id uuid REFERENCES public.shopify_connections(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_shop_orders_connection ON public.shop_orders (connection_id);

-- 4. Migrar shopify_stores existentes → shopify_connections
INSERT INTO public.shopify_connections (id, user_id, name, shop_domain, access_token, last_sync_at, last_sync_status, created_at, updated_at)
SELECT
  ss.id,
  ss.user_id,
  ss.shop_domain   AS name,
  ss.shop_domain,
  COALESCE(ss.access_token, '') AS access_token,
  ss.last_sync_at,
  COALESCE(ss.last_sync_status, 'ok') AS last_sync_status,
  ss.created_at,
  ss.updated_at
FROM public.shopify_stores ss
ON CONFLICT (user_id, shop_domain) DO UPDATE SET
  access_token      = EXCLUDED.access_token,
  last_sync_at      = EXCLUDED.last_sync_at,
  last_sync_status  = EXCLUDED.last_sync_status,
  updated_at        = now();

-- 5. Migrar relacionamentos existentes de shop_order_settings → shop_group_stores
INSERT INTO public.shop_group_stores (shop_id, connection_id, role, position)
SELECT sos.shop_id, sos.shopify_store_id, 'matrix', 0
FROM public.shop_order_settings sos
WHERE sos.shopify_store_id IS NOT NULL
  AND EXISTS (SELECT 1 FROM public.shopify_connections sc WHERE sc.id = sos.shopify_store_id)
ON CONFLICT (shop_id, connection_id) DO NOTHING;
