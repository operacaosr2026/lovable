-- Críticos do Gerencial pro número do menu lateral: a conta dos alertas é
-- pesada, então fica guardada (refeita a cada 15 min ou ao abrir o Gerencial).
CREATE TABLE IF NOT EXISTS public.gerencial_alert_cache (
  owner_id uuid NOT NULL,
  month text NOT NULL,          -- YYYY-MM
  critical_keys text[] NOT NULL DEFAULT '{}',
  computed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, month)
);
ALTER TABLE public.gerencial_alert_cache ENABLE ROW LEVEL SECURITY;
