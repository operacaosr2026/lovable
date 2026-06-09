
CREATE TABLE public.shop_cash_categories (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  shop_id UUID NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('income','expense')),
  name TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (shop_id, kind, name)
);

ALTER TABLE public.shop_cash_categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own shop_cash_categories all" ON public.shop_cash_categories
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_shop_cash_categories_shop ON public.shop_cash_categories(shop_id, kind, position);

CREATE TRIGGER set_shop_cash_categories_updated_at
  BEFORE UPDATE ON public.shop_cash_categories
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
