-- Banco de imagens: miniaturas (400px e 1400px) feitas no servidor quando a
-- foto entra, guardadas no bucket do lado do original — a grade deixa de usar
-- o Image Transformations do Supabase (cobrado por imagem acima de 100/mês).
-- previews_failed = formato que o servidor não lê (HEIC etc.): a tela mostra o
-- original e o preenchimento das antigas não tenta de novo.
alter table public.support_images
  add column if not exists thumb_path text,
  add column if not exists large_path text,
  add column if not exists previews_failed boolean not null default false;
