-- Permite marcar um pedido (ex: problema causado pelo cliente — endereço errado,
-- tamanho errado, etc.) para que ele saia da contagem dos KPIs de Rastreamento,
-- evitando que distorça os tempos médios de postagem/entrega.
alter table public.shop_orders
  add column if not exists kpi_excluded boolean not null default false;
