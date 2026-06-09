
CREATE TABLE public.shop_profit_goals (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  shop_id UUID NOT NULL UNIQUE,
  -- config
  target_profit NUMERIC NOT NULL DEFAULT 0,
  start_date DATE NOT NULL DEFAULT CURRENT_DATE,
  end_date DATE NOT NULL DEFAULT (CURRENT_DATE + INTERVAL '30 days'),
  sale_price NUMERIC NOT NULL DEFAULT 0,
  supplier_cost NUMERIC NOT NULL DEFAULT 0,
  fees_pct NUMERIC NOT NULL DEFAULT 0,
  max_cpa NUMERIC NOT NULL DEFAULT 0,
  -- operational (manual override; defaults to 0 when no integration)
  total_sales INTEGER NOT NULL DEFAULT 0,
  total_revenue NUMERIC NOT NULL DEFAULT 0,
  total_marketing NUMERIC NOT NULL DEFAULT 0,
  daily_budget NUMERIC NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'USD',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.shop_profit_goals TO authenticated;
GRANT ALL ON public.shop_profit_goals TO service_role;

ALTER TABLE public.shop_profit_goals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own shop_profit_goals all"
ON public.shop_profit_goals FOR ALL
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "members access shop_profit_goals"
ON public.shop_profit_goals FOR ALL
USING (public.has_workspace_access(auth.uid(), user_id, 'shops', shop_id))
WITH CHECK (public.has_workspace_access(auth.uid(), user_id, 'shops', shop_id));

CREATE TRIGGER set_updated_at_shop_profit_goals
BEFORE UPDATE ON public.shop_profit_goals
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
