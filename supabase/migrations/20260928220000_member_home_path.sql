-- Página que abre primeiro pro membro (Configurações > Membros > Permissões >
-- "Abrir primeiro"). Vazio = Dashboard. Ex.: '/shops/banco-de-lojas'.
ALTER TABLE public.workspace_members ADD COLUMN IF NOT EXISTS home_path text;
-- Reverter: ALTER TABLE public.workspace_members DROP COLUMN home_path;
