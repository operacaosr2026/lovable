ALTER TABLE public.app_settings
  ALTER COLUMN timezone SET DEFAULT 'America/New_York';

UPDATE public.app_settings
SET timezone = 'America/New_York'
WHERE timezone = 'America/Sao_Paulo';
