-- Tasks: kanban + tags + due_at + reminders
ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'todo',
  ADD COLUMN IF NOT EXISTS position integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tags text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS due_at timestamptz,
  ADD COLUMN IF NOT EXISTS reminder_minutes integer[] NOT NULL DEFAULT '{}';

-- Backfill: legacy done flag -> status; scheduled_date/time -> due_at
UPDATE public.tasks
  SET status = CASE WHEN done THEN 'done' ELSE 'todo' END
  WHERE status = 'todo';

UPDATE public.tasks
  SET due_at = (scheduled_date::text || ' ' || COALESCE(scheduled_time, '23:59') || ':00')::timestamptz
  WHERE due_at IS NULL AND scheduled_date IS NOT NULL;

CREATE INDEX IF NOT EXISTS tasks_user_status_pos_idx ON public.tasks(user_id, status, position);
CREATE INDEX IF NOT EXISTS tasks_user_due_idx ON public.tasks(user_id, due_at);

-- Notification history (dedupe)
CREATE TABLE IF NOT EXISTS public.task_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL,
  user_id uuid NOT NULL,
  kind text NOT NULL,
  minutes_before integer,
  sent_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS task_notif_lookup ON public.task_notifications(task_id, kind, minutes_before);
ALTER TABLE public.task_notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own task_notif all" ON public.task_notifications FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- User settings (WhatsApp)
CREATE TABLE IF NOT EXISTS public.user_settings (
  user_id uuid PRIMARY KEY,
  whatsapp_number text,
  whatsapp_enabled boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.user_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own settings all" ON public.user_settings FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- pg_cron + pg_net
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

SELECT cron.schedule(
  'task-notifications-tick',
  '* * * * *',
  $$
  SELECT net.http_post(
    url := 'https://project--fc8eaebe-f357-48d4-aa62-e814e4af0c57.lovable.app/api/public/hooks/task-notifications',
    headers := '{"Content-Type":"application/json","apikey":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ4YXZhY290bWhpa2V0eHNzaGNlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgxMjAwOTcsImV4cCI6MjA5MzY5NjA5N30.gpfQNnCWQjmCXeqr4yjghVyz23BKqI-lizJINfqXwkc"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);