-- Segurança (auditoria de out/2026).

-- 1) Função de outro projeto (referencia tabelas que não existem aqui) e
--    executável sem login. Nada no sistema usa.
DROP FUNCTION IF EXISTS public.srx_painel_saude(text, date, date);

-- 2) Funções de permissão (SECURITY DEFINER) chamáveis sem login via
--    /rest/v1/rpc. Ficam só pra quem está logado (as políticas RLS usam) e pro
--    servidor.
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.has_workspace_access(uuid, uuid, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.has_workspace_access(uuid, uuid, text, uuid) TO authenticated, service_role;

-- 3) Limite de tentativas das buscas públicas (rastreio por nº do pedido +
--    e-mail/telefone). Só o servidor lê/grava; guarda 1 dia.
CREATE TABLE IF NOT EXISTS public.public_rate_limits (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  bucket text NOT NULL,
  ip text NOT NULL,
  at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS public_rate_limits_lookup_idx ON public.public_rate_limits (bucket, ip, at DESC);
ALTER TABLE public.public_rate_limits ENABLE ROW LEVEL SECURITY;
