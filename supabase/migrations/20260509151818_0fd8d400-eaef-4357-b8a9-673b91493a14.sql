CREATE TABLE public.task_completion_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  task_id uuid NOT NULL,
  completed_on date NOT NULL DEFAULT CURRENT_DATE,
  completed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_task_completion_logs_user_task ON public.task_completion_logs(user_id, task_id, completed_on DESC);

ALTER TABLE public.task_completion_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own task_completion_logs all"
ON public.task_completion_logs
FOR ALL
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);