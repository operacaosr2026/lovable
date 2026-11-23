-- Criativos importados do Google Drive (pasta "qualquer pessoa com o link"):
-- o arquivo fica no Drive (media_path vazio) e o sistema guarda só a miniatura
-- (thumb_path/thumb_url). Ao publicar, a Meta baixa o vídeo direto do Drive.
-- last_used_at: última vez que a mídia foi enviada pra Meta.
ALTER TABLE public.product_creatives
  ADD COLUMN IF NOT EXISTS drive_file_id text,
  ADD COLUMN IF NOT EXISTS drive_url text,
  ADD COLUMN IF NOT EXISTS thumb_path text,
  ADD COLUMN IF NOT EXISTS thumb_url text,
  ADD COLUMN IF NOT EXISTS last_used_at timestamptz;

CREATE INDEX IF NOT EXISTS product_creatives_drive_idx
  ON public.product_creatives (product_id, drive_file_id) WHERE drive_file_id IS NOT NULL;
