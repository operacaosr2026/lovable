-- Reembolso pelo Atendimento: cobrar o cliente quando o produto for entregue?
-- Desmarcado (padrão) = o pedido não entra em Chargebacks > Alertas (rede "Reembolso").
alter table public.support_refund_requests
  add column if not exists charge_on_delivery boolean not null default false;
