-- Aba Anúncios do produto: cada publicação de campanha na Meta feita a partir
-- dos criativos do produto. config guarda o que foi escolhido (conta, página,
-- pixel, orçamento, link...) e serve pra pré-preencher a próxima; ads guarda
-- o resultado por criativo ({ creative_id, name, adset_id, ad_id, error }).
-- Acesso só pelo servidor (service role): RLS ligado e sem policies.

CREATE TABLE IF NOT EXISTS public.product_ad_publications (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL,
  product_id    uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  shop_id       uuid NOT NULL,
  ad_account_id text NOT NULL,
  campaign_id   text,
  campaign_name text NOT NULL,
  status        text NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'ok', 'partial', 'error')),
  config        jsonb NOT NULL DEFAULT '{}'::jsonb,
  ads           jsonb NOT NULL DEFAULT '[]'::jsonb,
  error         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS product_ad_publications_product_idx ON public.product_ad_publications (product_id, created_at DESC);

DROP TRIGGER IF EXISTS product_ad_publications_updated_at ON public.product_ad_publications;
CREATE TRIGGER product_ad_publications_updated_at BEFORE UPDATE ON public.product_ad_publications
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.product_ad_publications ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.product_ad_publications TO service_role;
