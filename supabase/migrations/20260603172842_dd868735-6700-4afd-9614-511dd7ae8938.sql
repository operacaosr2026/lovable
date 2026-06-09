
CREATE TABLE public.app_settings (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  app_name text NOT NULL DEFAULT 'Adam App',
  logo_url text,
  favicon_url text,
  primary_color text NOT NULL DEFAULT 'oklch(0.58 0.22 295)',
  language text NOT NULL DEFAULT 'pt-BR',
  timezone text NOT NULL DEFAULT 'America/Sao_Paulo',
  date_format text NOT NULL DEFAULT 'DD/MM/YYYY',
  default_home text NOT NULL DEFAULT '/',
  theme text NOT NULL DEFAULT 'system',
  font_size text NOT NULL DEFAULT 'medium',
  density text NOT NULL DEFAULT 'standard',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.app_settings TO authenticated;
GRANT ALL ON public.app_settings TO service_role;

ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own settings all" ON public.app_settings
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER app_settings_updated_at
  BEFORE UPDATE ON public.app_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.login_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  ip text,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, DELETE ON public.login_history TO authenticated;
GRANT ALL ON public.login_history TO service_role;

ALTER TABLE public.login_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own login_history select" ON public.login_history
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "own login_history insert" ON public.login_history
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "own login_history delete" ON public.login_history
  FOR DELETE USING (auth.uid() = user_id);

CREATE INDEX login_history_user_created_idx ON public.login_history(user_id, created_at DESC);
