-- Banco de imagens: "impressão digital" visual (dHash 64 bits, hex) pra não
-- repetir a mesma foto reenviada comprimida / com outro nome na conversa.
alter table public.support_images add column if not exists phash text;
create index if not exists support_images_conv_phash_idx on public.support_images (conversation_id) where phash is not null;
