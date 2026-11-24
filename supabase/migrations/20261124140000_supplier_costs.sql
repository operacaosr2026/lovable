-- Dois fornecedores com preços diferentes pro mesmo produto.
--  - products.cost (+ product_cost_history) continua sendo o preço da Alice
--    (fornecedor base, de sempre).
--  - product_supplier_costs: preço do produto em outro fornecedor (FlowBorder…).
--  - products.default_supplier: fornecedor padrão do produto — o preço dele vale
--    pro lucro e a previsão do Caixa enquanto o pedido não foi pago (null = Alice).
--  - shop_orders.paid_supplier: fornecedor que recebeu o pagamento do pedido
--    (gravado ao pagar, igual ao do lote); pedido pago usa o preço dele.
alter table public.products add column if not exists default_supplier text;

create table if not exists public.product_supplier_costs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  supplier text not null,
  cost numeric(12, 2) not null check (cost >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (product_id, supplier)
);
create index if not exists product_supplier_costs_user_idx on public.product_supplier_costs (user_id);

alter table public.product_supplier_costs enable row level security;
create policy "own product_supplier_costs all" on public.product_supplier_costs
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "members access product_supplier_costs" on public.product_supplier_costs
  for all using (has_workspace_access(auth.uid(), user_id, 'shops'::text, NULL::uuid))
  with check (has_workspace_access(auth.uid(), user_id, 'shops'::text, NULL::uuid));

alter table public.shop_orders add column if not exists paid_supplier text;
update public.shop_orders o set paid_supplier = b.supplier
  from public.shop_order_payment_batches b
  where o.payment_batch_id = b.id and o.payment_status <> 'pending' and o.paid_supplier is null;
