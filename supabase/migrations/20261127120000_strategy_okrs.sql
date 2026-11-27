-- Gerencial › Planejamento: objetivos por trimestre (OKR), resultados-chave
-- medidos (início → meta, valor atual) e iniciativas que fazem o objetivo
-- andar (responsável, prazo, status; pode apontar pra um Projeto).
-- Acesso só pelo servidor (supabaseAdmin), filtrando pelo dono do workspace.

CREATE TABLE IF NOT EXISTS public.strategy_objectives (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL,
  quarter     text NOT NULL,              -- ex.: 2026-T4
  title       text NOT NULL,
  description text,
  owner_id    uuid,
  position    integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS strategy_objectives_quarter_idx ON public.strategy_objectives (user_id, quarter, position);

CREATE TABLE IF NOT EXISTS public.strategy_key_results (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL,
  objective_id  uuid NOT NULL REFERENCES public.strategy_objectives(id) ON DELETE CASCADE,
  title         text NOT NULL,
  unit          text NOT NULL DEFAULT 'numero', -- numero | pct | usd
  start_value   numeric NOT NULL DEFAULT 0,
  target_value  numeric NOT NULL,
  current_value numeric NOT NULL DEFAULT 0,
  position      integer NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS strategy_key_results_objective_idx ON public.strategy_key_results (objective_id, position);

CREATE TABLE IF NOT EXISTS public.strategy_initiatives (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL,
  objective_id uuid NOT NULL REFERENCES public.strategy_objectives(id) ON DELETE CASCADE,
  title        text NOT NULL,
  owner_id     uuid,
  due_date     date,
  status       text NOT NULL DEFAULT 'a_fazer', -- a_fazer | em_andamento | concluida
  project_id   uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  position     integer NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS strategy_initiatives_objective_idx ON public.strategy_initiatives (objective_id, position);

ALTER TABLE public.strategy_objectives ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.strategy_key_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.strategy_initiatives ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.strategy_objectives, public.strategy_key_results, public.strategy_initiatives TO service_role;

CREATE TRIGGER strategy_objectives_set_updated_at BEFORE UPDATE ON public.strategy_objectives FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER strategy_key_results_set_updated_at BEFORE UPDATE ON public.strategy_key_results FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER strategy_initiatives_set_updated_at BEFORE UPDATE ON public.strategy_initiatives FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
