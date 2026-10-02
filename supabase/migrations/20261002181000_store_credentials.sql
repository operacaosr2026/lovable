-- Logins, senhas e tokens guardados por loja do Banco de Lojas (janela de
-- detalhes da loja). Acesso só pelo servidor (service role): RLS ligado e sem
-- policies.
CREATE TABLE IF NOT EXISTS public.store_credentials (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL,              -- dono do workspace
  shopify_store_id uuid NOT NULL REFERENCES public.shopify_stores(id) ON DELETE CASCADE,
  label            text NOT NULL CHECK (char_length(label) BETWEEN 1 AND 100),
  value            text NOT NULL DEFAULT '' CHECK (char_length(value) <= 5000),
  position         integer NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS store_credentials_store_idx ON public.store_credentials (user_id, shopify_store_id);

DROP TRIGGER IF EXISTS store_credentials_updated_at ON public.store_credentials;
CREATE TRIGGER store_credentials_updated_at BEFORE UPDATE ON public.store_credentials
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.store_credentials ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.store_credentials TO service_role;
