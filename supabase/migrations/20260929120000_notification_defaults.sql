-- Padrões de notificação: Lucro do dia às 00:00, 12:00 e 20:00 e Não Perturbe
-- das 00:00 às 07:00. Vale pra quem ainda não mexeu (linha nova ou com o
-- padrão antigo: sem horário de lucro / Não Perturbe 23:00–07:00).
ALTER TABLE public.notification_settings
  ALTER COLUMN profit_times SET DEFAULT '{00:00,12:00,20:00}',
  ALTER COLUMN dnd_start SET DEFAULT '00:00',
  ALTER COLUMN dnd_end SET DEFAULT '07:00';

UPDATE public.notification_settings SET profit_times = '{00:00,12:00,20:00}'
  WHERE profit_times = '{}';
UPDATE public.notification_settings SET dnd_start = '00:00', dnd_end = '07:00'
  WHERE dnd_start = '23:00' AND dnd_end = '07:00';
-- Reverter: ALTER ... SET DEFAULT '{}' / '23:00' / '07:00'.
