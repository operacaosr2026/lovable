-- Remove módulo Pessoal (Hábitos, Tarefas, Calendário)
SELECT cron.unschedule('task-notifications-tick');

DROP TABLE IF EXISTS public.task_notifications CASCADE;
DROP TABLE IF EXISTS public.task_attachments CASCADE;
DROP TABLE IF EXISTS public.tasks CASCADE;
DROP TABLE IF EXISTS public.task_lists CASCADE;
DROP TABLE IF EXISTS public.user_settings CASCADE;
DROP TABLE IF EXISTS public.habit_logs CASCADE;
DROP TABLE IF EXISTS public.habits CASCADE;
DROP TABLE IF EXISTS public.calendar_events CASCADE;
