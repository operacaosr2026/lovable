-- Metas da empresa (uma por mês), no lugar das metas por grupo (lg_card_goals).
-- A meta mede o lucro das lojas dos grupos ativos. Quando o mês fecha, o
-- realizado é congelado (realizado_final + as lojas que contavam) — arquivar um
-- grupo depois não muda o histórico. Ver company-goals.server.ts.

CREATE TABLE IF NOT EXISTS public.company_goals (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL,
  month           date NOT NULL,            -- sempre dia 1 do mês
  meta            numeric NOT NULL,
  lucro_por_venda numeric,
  realizado_final numeric,                  -- preenchido quando o mês fecha
  shop_ids_final  uuid[],                   -- lojas que contaram no mês (congeladas)
  frozen_at       timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, month)
);
ALTER TABLE public.company_goals ENABLE ROW LEVEL SECURITY;
-- Sem policy: só o servidor (service role) lê e grava, sempre filtrando pelo dono.

-- Quando o grupo deixou de ser ativo (arquivado/pausado). O grupo continua
-- contando nas metas do mês em que saiu — o que já somou não some.
ALTER TABLE public.lg_cards ADD COLUMN IF NOT EXISTS inactive_since timestamptz;

-- Metas por grupo que já existiam viram metas da empresa: uma por grupo e mês
-- (a não encerrada, ou a mais recente), somadas por mês. Meses já fechados
-- guardam as lojas dos grupos que tinham a meta, pra o realizado ser calculado
-- com elas e congelado.
WITH g AS (
  SELECT DISTINCT ON (card_id, date_trunc('month', start_date)) *
  FROM public.lg_card_goals
  ORDER BY card_id, date_trunc('month', start_date), (closed_at IS NULL) DESC, created_at DESC
), m AS (
  SELECT user_id, date_trunc('month', start_date)::date AS month,
         sum(meta) AS meta, max(lucro_por_venda) AS lucro_por_venda, array_agg(card_id) AS cards
  FROM g GROUP BY 1, 2
)
INSERT INTO public.company_goals (user_id, month, meta, lucro_por_venda, shop_ids_final)
SELECT m.user_id, m.month, m.meta, m.lucro_por_venda,
       CASE WHEN m.month < date_trunc('month', now() AT TIME ZONE 'America/New_York')::date
            THEN (SELECT array_agg(DISTINCT cs.shop_id) FROM public.lg_card_shops cs WHERE cs.card_id = ANY (m.cards))
       END
FROM m
ON CONFLICT (user_id, month) DO NOTHING;
