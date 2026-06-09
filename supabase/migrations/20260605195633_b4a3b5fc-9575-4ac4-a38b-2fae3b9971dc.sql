ALTER TABLE public.category_rules ADD COLUMN IF NOT EXISTS applies_to text NOT NULL DEFAULT 'any';
ALTER TABLE public.category_rules DROP CONSTRAINT IF EXISTS category_rules_applies_to_check;
ALTER TABLE public.category_rules ADD CONSTRAINT category_rules_applies_to_check CHECK (applies_to IN ('any','income','expense'));