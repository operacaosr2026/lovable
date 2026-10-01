-- Inteligência: o que a IA precisa saber sobre o negócio (decisões já tomadas,
-- testes que o dono está fazendo por conta própria) — texto livre, sem tela:
-- é gravado por SQL e vai junto com os números em toda análise.
CREATE TABLE IF NOT EXISTS public.consultant_settings (
  user_id     uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  context     text NOT NULL DEFAULT '',
  updated_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.consultant_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner_consultant_settings"
  ON public.consultant_settings FOR ALL USING (auth.uid() = user_id);

-- Reverter:
-- DROP TABLE public.consultant_settings;
