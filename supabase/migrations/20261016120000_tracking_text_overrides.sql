-- Textos do rastreio trocados na mão (Configurações › Rastreamento › Textos):
-- o texto que vem da transportadora (text_key = eventTextKey em
-- tracking-display.ts: minúsculo, sem ponto final, números viram #) aparece pro
-- cliente como display_text. Vale antes de qualquer outra regra.
CREATE TABLE IF NOT EXISTS public.tracking_text_overrides (
  id            uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  text_key      text NOT NULL,
  example_text  text NOT NULL DEFAULT '',
  display_text  text NOT NULL,
  updated_at    timestamptz DEFAULT now(),
  UNIQUE (user_id, text_key)
);

ALTER TABLE public.tracking_text_overrides ENABLE ROW LEVEL SECURITY;

CREATE POLICY "owner_tracking_text_overrides"
  ON public.tracking_text_overrides FOR ALL USING (auth.uid() = user_id);

-- Reverter:
-- DROP TABLE public.tracking_text_overrides;
