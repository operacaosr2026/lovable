-- Gerencial › Alertas: alerta desconsiderado some da lista no mês (pra toda a
-- equipe do dono) e volta no mês seguinte. Lido/gravado só pelo servidor.
CREATE TABLE IF NOT EXISTS public.gerencial_alert_dismissals (
  owner_id uuid NOT NULL,
  month text NOT NULL,          -- YYYY-MM
  alert_key text NOT NULL,      -- GerencialAlert.key (ex: "meta", "prejuizo:<grupo>")
  dismissed_by uuid,
  dismissed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, month, alert_key)
);
ALTER TABLE public.gerencial_alert_dismissals ENABLE ROW LEVEL SECURITY;
