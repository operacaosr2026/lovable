
-- Drop old tables
DROP TABLE IF EXISTS public.bills CASCADE;
DROP TABLE IF EXISTS public.net_worth_snapshots CASCADE;

-- Accounts
CREATE TABLE public.accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  name text NOT NULL,
  currency text NOT NULL CHECK (currency IN ('BRL','USD')),
  color text NOT NULL DEFAULT 'oklch(0.6 0.22 285)',
  icon_url text,
  position integer NOT NULL DEFAULT 0,
  archived boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own accounts all" ON public.accounts FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Categories
CREATE TABLE public.categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  name text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('income','expense')),
  color text NOT NULL DEFAULT 'oklch(0.62 0.012 270)',
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own categories all" ON public.categories FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Recurrences
CREATE TABLE public.recurrences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('income','expense')),
  amount numeric NOT NULL CHECK (amount > 0),
  currency text NOT NULL CHECK (currency IN ('BRL','USD')),
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  category_id uuid REFERENCES public.categories(id) ON DELETE SET NULL,
  description text,
  frequency text NOT NULL CHECK (frequency IN ('weekly','monthly','yearly')),
  next_date date NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.recurrences ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own recurrences all" ON public.recurrences FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Transactions
CREATE TABLE public.transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('income','expense','transfer')),
  amount numeric NOT NULL CHECK (amount > 0),
  currency text NOT NULL CHECK (currency IN ('BRL','USD')),
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  to_account_id uuid REFERENCES public.accounts(id) ON DELETE CASCADE,
  category_id uuid REFERENCES public.categories(id) ON DELETE SET NULL,
  description text,
  date date NOT NULL DEFAULT CURRENT_DATE,
  recurrence_id uuid REFERENCES public.recurrences(id) ON DELETE SET NULL,
  paid boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own transactions all" ON public.transactions FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX tx_user_date_idx ON public.transactions(user_id, date DESC);
CREATE INDEX tx_account_idx ON public.transactions(account_id);

-- Financial goals
CREATE TABLE public.financial_goals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  period text NOT NULL CHECK (period IN ('monthly','yearly')),
  target_amount_brl numeric NOT NULL CHECK (target_amount_brl > 0),
  year integer NOT NULL,
  month integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, period, year, month)
);
ALTER TABLE public.financial_goals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own goals all" ON public.financial_goals FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- FX rates (1 row per user)
CREATE TABLE public.fx_rates (
  user_id uuid PRIMARY KEY,
  usd_to_brl numeric NOT NULL DEFAULT 5.0 CHECK (usd_to_brl > 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.fx_rates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own fx all" ON public.fx_rates FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Storage bucket for account icons
INSERT INTO storage.buckets (id, name, public) VALUES ('account-icons', 'account-icons', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "icons public read" ON storage.objects FOR SELECT USING (bucket_id = 'account-icons');
CREATE POLICY "icons own insert" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'account-icons' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "icons own update" ON storage.objects FOR UPDATE USING (bucket_id = 'account-icons' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "icons own delete" ON storage.objects FOR DELETE USING (bucket_id = 'account-icons' AND auth.uid()::text = (storage.foldername(name))[1]);

-- Update handle_new_user to seed categories + fx
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, avatar_url)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)),
    NEW.raw_user_meta_data->>'avatar_url'
  );

  INSERT INTO public.stores (user_id, name, color, position) VALUES
    (NEW.id, 'Walkesty',    'oklch(0.6 0.22 285)',  0),
    (NEW.id, 'The Ravien',  'oklch(0.62 0.14 155)', 1),
    (NEW.id, 'The Kickest', 'oklch(0.7 0.14 75)',   2);

  INSERT INTO public.categories (user_id, name, kind, color) VALUES
    (NEW.id, 'Vendas',        'income',  'oklch(0.62 0.14 155)'),
    (NEW.id, 'Recebimentos',  'income',  'oklch(0.65 0.14 195)'),
    (NEW.id, 'Investimentos', 'income',  'oklch(0.6 0.22 285)'),
    (NEW.id, 'Ferramentas',   'expense', 'oklch(0.7 0.14 75)'),
    (NEW.id, 'Pessoal',       'expense', 'oklch(0.65 0.16 25)'),
    (NEW.id, 'Impostos',      'expense', 'oklch(0.55 0.16 0)'),
    (NEW.id, 'Outros',        'expense', 'oklch(0.62 0.012 270)');

  INSERT INTO public.fx_rates (user_id, usd_to_brl) VALUES (NEW.id, 5.0);

  RETURN NEW;
END;
$$;

-- Backfill for existing user(s)
INSERT INTO public.categories (user_id, name, kind, color)
SELECT p.id, c.name, c.kind, c.color FROM public.profiles p
CROSS JOIN (VALUES
  ('Vendas','income','oklch(0.62 0.14 155)'),
  ('Recebimentos','income','oklch(0.65 0.14 195)'),
  ('Investimentos','income','oklch(0.6 0.22 285)'),
  ('Ferramentas','expense','oklch(0.7 0.14 75)'),
  ('Pessoal','expense','oklch(0.65 0.16 25)'),
  ('Impostos','expense','oklch(0.55 0.16 0)'),
  ('Outros','expense','oklch(0.62 0.012 270)')
) AS c(name, kind, color)
WHERE NOT EXISTS (SELECT 1 FROM public.categories WHERE user_id = p.id);

INSERT INTO public.fx_rates (user_id, usd_to_brl)
SELECT id, 5.0 FROM public.profiles
ON CONFLICT (user_id) DO NOTHING;
