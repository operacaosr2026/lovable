-- Loja base das políticas (reembolso, privacidade, termos, frete, contato,
-- aviso legal): quando uma loja nova é conectada, as políticas dela são
-- comparadas com as da base e o que estiver diferente vira aviso no sino
-- (store-policies.server.ts). Uma por workspace; hoje a Loja 5 - The Voultie.
ALTER TABLE public.shopify_stores
  ADD COLUMN IF NOT EXISTS policy_base boolean NOT NULL DEFAULT false;

CREATE UNIQUE INDEX IF NOT EXISTS shopify_stores_policy_base_uniq
  ON public.shopify_stores (user_id) WHERE policy_base;

UPDATE public.shopify_stores SET policy_base = true WHERE shop_domain = 'xnmkej-an.myshopify.com';
-- Reverter: DROP INDEX public.shopify_stores_policy_base_uniq; ALTER TABLE public.shopify_stores DROP COLUMN policy_base;
