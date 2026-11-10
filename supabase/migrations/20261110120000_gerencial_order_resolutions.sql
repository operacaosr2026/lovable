-- Gerencial › Alertas de rastreio: pedido marcado como resolvido sai daquele
-- alerta (e da contagem) pra toda a equipe do dono. Vale enquanto o código de
-- rastreio for o mesmo — trocou o código (reenvio), a marcação não vale mais.
-- Lido/gravado só pelo servidor.
CREATE TABLE IF NOT EXISTS public.gerencial_order_resolutions (
  owner_id uuid NOT NULL,
  order_id uuid NOT NULL,
  alert_kind text NOT NULL,     -- ex: "rastreio:nao_postado", "entrega", "fora:sem_evento"
  tracking_code text,           -- código no momento em que foi marcado
  resolved_by uuid,
  resolved_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, order_id, alert_kind)
);
ALTER TABLE public.gerencial_order_resolutions ENABLE ROW LEVEL SECURITY;
