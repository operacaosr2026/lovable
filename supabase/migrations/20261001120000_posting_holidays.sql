-- Feriados do TM Postagem (Configurações → Feriados). O TM Postagem conta dias
-- úteis (seg-sex) entre o pedido e a 1ª movimentação do rastreio; quem posta é o
-- fornecedor na China, então os feriados de lá param a postagem.
--  - kind 'holiday': dia de semana que NÃO conta (ex.: Golden Week);
--  - kind 'workday': sábado/domingo que CONTA (dia de compensação chinês, 调休).
CREATE TABLE IF NOT EXISTS public.posting_holidays (
  id          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  day         date NOT NULL,
  name        text NOT NULL DEFAULT '',
  kind        text NOT NULL DEFAULT 'holiday' CHECK (kind IN ('holiday', 'workday')),
  created_at  timestamptz DEFAULT now(),
  UNIQUE (user_id, day)
);

ALTER TABLE public.posting_holidays ENABLE ROW LEVEL SECURITY;

CREATE POLICY "owner_posting_holidays"
  ON public.posting_holidays FOR ALL USING (auth.uid() = user_id);

-- Reverter:
-- DROP TABLE public.posting_holidays;
