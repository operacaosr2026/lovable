-- Código da transportadora local dos EUA (última milha) que o 17track devolve
-- em misc_info.local_number — hoje só vem quando é USPS (92…/93…/94…).
alter table public.shop_order_tracking add column if not exists local_tracking_number text;
