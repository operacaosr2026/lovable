-- Microsoft Clarity por produto (um projeto Clarity por produto; token na aba
-- Inteligência › Testes): token da Data Export API e as respostas guardadas
-- por dia. A API só devolve as últimas 24h a partir da chamada e no máximo 10
-- chamadas por projeto por dia, então a busca automática roda logo depois da
-- meia-noite de Nova York (dia que fechou) e o botão "Buscar agora" grava o
-- dia de hoje como parcial. A resposta fica crua (raw) e é lida na hora de
-- montar a tabela do teste.
-- Acesso só pelo servidor (service role): RLS ligado e sem policies.

-- Primeira versão era por loja; sem dados que importem ainda.
DROP TABLE IF EXISTS public.clarity_snapshots;
DROP TABLE IF EXISTS public.clarity_calls;
DROP TABLE IF EXISTS public.clarity_connections;

CREATE TABLE public.clarity_connections (
  product_id    uuid PRIMARY KEY REFERENCES public.products(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL,
  token         text NOT NULL,
  last_fetch_at timestamptz,
  last_error    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- Cada chamada à API (pra mostrar quantas restam no dia).
CREATE TABLE public.clarity_calls (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  kind       text NOT NULL CHECK (kind IN ('auto', 'manual')),
  ok         boolean NOT NULL,
  called_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX clarity_calls_product_idx ON public.clarity_calls (product_id, called_at DESC);

CREATE TABLE public.clarity_snapshots (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  day        date NOT NULL,                 -- dia de Nova York
  partial    boolean NOT NULL DEFAULT false,-- true = "Buscar agora" (dia ainda aberto)
  raw        jsonb NOT NULL,                -- resposta da API (dimensões Campaign + Medium)
  fetched_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (product_id, day)
);

ALTER TABLE public.clarity_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clarity_calls ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clarity_snapshots ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.clarity_connections, public.clarity_calls, public.clarity_snapshots TO service_role;

-- Busca automática: 00:10 de Nova York. pg_cron roda em UTC, então agenda
-- 04:10 e 05:10 UTC e o servidor só busca na que cair na meia-noite de NY
-- (horário de verão e de inverno).
SELECT cron.unschedule(jobname) FROM cron.job WHERE jobname = 'clarity-daily';

SELECT cron.schedule(
  'clarity-daily',
  '10 4,5 * * *',
  $$
  SELECT net.http_post(
    url     := 'https://lojas-one.vercel.app/api/public/hooks/clarity-daily',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-api-key', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_api_key')
    ),
    body    := '{}'::jsonb
  );
  $$
);
