-- Templates de produção também levam políticas e arquivos. Ao aplicar no card,
-- políticas e arquivos que a loja ainda não tem (pelo nome) são copiados.
-- Arquivos no bucket store-production em {dono}/presets/{template}/...
-- Acesso só pelo servidor (service role): RLS ligado e sem policies.

ALTER TABLE public.store_production_presets
  ADD COLUMN IF NOT EXISTS policies jsonb NOT NULL DEFAULT '[]'::jsonb;

CREATE TABLE IF NOT EXISTS public.store_production_preset_files (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL,
  preset_id   uuid NOT NULL REFERENCES public.store_production_presets(id) ON DELETE CASCADE,
  name        text NOT NULL,
  path        text NOT NULL,
  size        bigint NOT NULL DEFAULT 0,
  mime        text,
  uploaded_by uuid,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS store_production_preset_files_preset_idx ON public.store_production_preset_files (user_id, preset_id);

ALTER TABLE public.store_production_preset_files ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.store_production_preset_files TO service_role;
