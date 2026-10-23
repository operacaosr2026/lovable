-- Banco de imagens: a IA marca cada imagem como 'foto' (produto, caixa, etiqueta)
-- ou 'print' (captura de tela, e-mail, site, texto). A grade só mostra foto
-- (null = ainda não classificada / sem chave da IA → aparece).
alter table public.support_images add column if not exists kind text check (kind in ('foto', 'print'));
