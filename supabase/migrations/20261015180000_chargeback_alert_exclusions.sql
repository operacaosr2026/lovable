-- Chargebacks > Alertas: pedido excluído à mão da lista (com motivo). Fica
-- guardado aqui — o alerta é recalculado a partir dos pedidos a cada abertura,
-- então a marca no acompanhamento é o que impede ele de voltar. Excluído não
-- entra na cobrança automática nem nos números; aparece só no filtro "Excluídos".
ALTER TABLE public.chargeback_alert_followups
  ADD COLUMN IF NOT EXISTS excluded_at     timestamptz,
  ADD COLUMN IF NOT EXISTS excluded_reason text,
  ADD COLUMN IF NOT EXISTS excluded_by     uuid;

-- Reverter:
-- ALTER TABLE public.chargeback_alert_followups DROP COLUMN excluded_at, DROP COLUMN excluded_reason, DROP COLUMN excluded_by;
