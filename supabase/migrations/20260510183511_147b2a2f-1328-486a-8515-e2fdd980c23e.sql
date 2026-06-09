ALTER TABLE public.shop_cash_entries
  ADD COLUMN IF NOT EXISTS recurrence text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS recurrence_until date;