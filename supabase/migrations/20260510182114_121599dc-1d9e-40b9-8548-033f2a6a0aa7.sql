
ALTER TABLE public.shops ADD COLUMN IF NOT EXISTS opening_balance NUMERIC NOT NULL DEFAULT 0;

CREATE TABLE public.shop_cash_imports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  shop_id UUID NOT NULL,
  file_name TEXT NOT NULL,
  file_hash TEXT,
  total_rows INTEGER NOT NULL DEFAULT 0,
  total_amount NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.shop_cash_imports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own shop_cash_imports all" ON public.shop_cash_imports FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX idx_shop_cash_imports_shop ON public.shop_cash_imports(shop_id);
CREATE UNIQUE INDEX idx_shop_cash_imports_hash ON public.shop_cash_imports(shop_id, file_hash) WHERE file_hash IS NOT NULL;

CREATE TABLE public.shop_cash_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  shop_id UUID NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('income','expense')),
  category TEXT,
  description TEXT,
  amount NUMERIC NOT NULL DEFAULT 0,
  date DATE NOT NULL,
  source TEXT NOT NULL DEFAULT 'manual',
  import_id UUID REFERENCES public.shop_cash_imports(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.shop_cash_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own shop_cash_entries all" ON public.shop_cash_entries FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX idx_shop_cash_entries_shop_date ON public.shop_cash_entries(shop_id, date);
CREATE INDEX idx_shop_cash_entries_import ON public.shop_cash_entries(import_id);

CREATE TRIGGER shop_cash_entries_updated_at BEFORE UPDATE ON public.shop_cash_entries
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
