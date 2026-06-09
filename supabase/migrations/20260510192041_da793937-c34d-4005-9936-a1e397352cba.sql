
-- products
CREATE TABLE public.products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  name text NOT NULL,
  niche text,
  supplier text,
  cost numeric NOT NULL DEFAULT 0,
  sale_price numeric NOT NULL DEFAULT 0,
  description text,
  status text NOT NULL DEFAULT 'ativo',
  main_image_url text,
  position integer NOT NULL DEFAULT 0,
  archived boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own products all" ON public.products FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER trg_products_updated BEFORE UPDATE ON public.products FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- product_images
CREATE TABLE public.product_images (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  file_path text NOT NULL,
  file_url text,
  file_name text,
  mime_type text,
  size_bytes bigint,
  is_main boolean NOT NULL DEFAULT false,
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.product_images ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own product_images all" ON public.product_images FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- product_templates
CREATE TABLE public.product_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  kind text NOT NULL DEFAULT 'file',
  file_path text,
  file_url text,
  file_name text,
  mime_type text,
  size_bytes bigint,
  pagefly_url text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.product_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own product_templates all" ON public.product_templates FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- product_creatives
CREATE TABLE public.product_creatives (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  title text NOT NULL DEFAULT '',
  description text,
  status text NOT NULL DEFAULT 'lancar',
  media_url text,
  media_path text,
  media_kind text,
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.product_creatives ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own product_creatives all" ON public.product_creatives FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER trg_product_creatives_updated BEFORE UPDATE ON public.product_creatives FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- product_pricing
CREATE TABLE public.product_pricing (
  product_id uuid PRIMARY KEY REFERENCES public.products(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  iof_pct numeric NOT NULL DEFAULT 0,
  payments_pct numeric NOT NULL DEFAULT 0,
  dom_pagamentos_pct numeric NOT NULL DEFAULT 0,
  retorno_chargeback_pct numeric NOT NULL DEFAULT 0,
  imposto_pct numeric NOT NULL DEFAULT 0,
  marketing_pct numeric NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.product_pricing ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own product_pricing all" ON public.product_pricing FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER trg_product_pricing_updated BEFORE UPDATE ON public.product_pricing FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- shop_products: link to global product
ALTER TABLE public.shop_products ADD COLUMN product_id uuid;

CREATE INDEX idx_product_images_product ON public.product_images(product_id);
CREATE INDEX idx_product_templates_product ON public.product_templates(product_id);
CREATE INDEX idx_product_creatives_product ON public.product_creatives(product_id);
CREATE INDEX idx_shop_products_product ON public.shop_products(product_id);
