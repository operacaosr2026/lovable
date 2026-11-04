-- Fase de cada texto do rastreio escolhida na mão (Configurações › Rastreamento
-- › Textos): a conta do Gerencial › Transportadoras (carrier-stats.ts) usa a
-- fase daqui antes das regras automáticas. text_key = eventTextKey em
-- tracking-display.ts (mesma chave de tracking_text_overrides).
-- phase: aviso | movimento | voo | chegada_eua | alfandega_entrada | alfandega_saida | entregue
CREATE TABLE IF NOT EXISTS public.tracking_phase_overrides (
  id            uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  text_key      text NOT NULL,
  example_text  text NOT NULL DEFAULT '',
  phase         text NOT NULL CHECK (phase IN ('aviso', 'movimento', 'voo', 'chegada_eua', 'alfandega_entrada', 'alfandega_saida', 'entregue')),
  updated_at    timestamptz DEFAULT now(),
  UNIQUE (user_id, text_key)
);

ALTER TABLE public.tracking_phase_overrides ENABLE ROW LEVEL SECURITY;

CREATE POLICY "owner_tracking_phase_overrides"
  ON public.tracking_phase_overrides FOR ALL USING (auth.uid() = user_id);

-- Reverter:
-- DROP TABLE public.tracking_phase_overrides;
