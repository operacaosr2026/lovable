-- Aviso do fornecedor sobre um pedido (ex.: "não pode ser enviado — falta de
-- estoque"). Vira o alerta "Sem estoque no fornecedor" no Gerencial enquanto o
-- pacote não andar no rastreio (postou = some sozinho) e o código for o mesmo.
-- Lido/gravado só pelo servidor.
CREATE TABLE IF NOT EXISTS public.order_supplier_flags (
  owner_id uuid NOT NULL,
  order_id uuid NOT NULL,
  kind text NOT NULL DEFAULT 'sem_estoque',
  note text,                    -- o que o fornecedor disse
  tracking_code text,           -- código no momento do aviso
  flagged_by uuid,
  flagged_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, order_id, kind)
);
ALTER TABLE public.order_supplier_flags ENABLE ROW LEVEL SECURITY;
