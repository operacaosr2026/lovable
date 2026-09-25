-- Auditoria (Configurações > Auditoria): toda ação de usuário que grava algo
-- pelo servidor — quem, o quê, quando e os dados enviados. Só admin vê; mais de
-- 1 ano é apagado pelo job diário (estorno-daily). Ver audit.server.ts.

CREATE TABLE IF NOT EXISTS public.audit_log (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id     uuid NOT NULL,          -- workspace (dono)
  actor_id     uuid NOT NULL,          -- quem fez
  actor_email  text,
  action       text NOT NULL,          -- nome técnico da ação (ex.: markOrdersPaid)
  label        text NOT NULL,          -- descrição legível (ex.: Marcou pedidos como pagos)
  data         jsonb,                  -- dados enviados (senhas/tokens removidos)
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_log_owner_created_idx ON public.audit_log (owner_id, created_at DESC);
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;
-- Sem policy: só o servidor (service role) lê e grava.
