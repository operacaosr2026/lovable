ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS recurrence_frequency text,
  ADD COLUMN IF NOT EXISTS recurrence_weekdays integer[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS recurrence_time text;