-- Banco de imagens:
-- • pedido e produtos da foto (pedido citado no assunto, senão o último do
--   cliente até a data do e-mail) — filtro por produto na tela;
-- • baixada = já usada: sai da grade (fica em "Baixadas").
alter table public.support_images
  add column if not exists order_id uuid,
  add column if not exists products text[] not null default '{}',
  add column if not exists downloaded_at timestamptz,
  add column if not exists downloaded_by uuid;
create index if not exists support_images_products_idx on public.support_images using gin (products);
