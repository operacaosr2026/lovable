-- Produto › Criativos: pastas (ex.: uma por cor/variante) e ligação com a pasta
-- "Criativos" do Google Drive. Cada subpasta do Drive vira uma pasta aqui
-- (drive_folder_id); arquivos soltos na raiz, quando há subpastas, vão pra "Geral"
-- (drive_folder_id = a própria raiz). Pasta criada à mão não tem drive_folder_id.

CREATE TABLE IF NOT EXISTS public.product_creative_folders (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL,
  product_id      uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  name            text NOT NULL,
  drive_folder_id text,
  position        integer NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS product_creative_folders_product_idx ON public.product_creative_folders (product_id, position);
CREATE UNIQUE INDEX IF NOT EXISTS product_creative_folders_drive_uq
  ON public.product_creative_folders (product_id, drive_folder_id) WHERE drive_folder_id IS NOT NULL;
ALTER TABLE public.product_creative_folders ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.product_creative_folders TO service_role;

-- folder_id: pasta do criativo (vazio = sem pasta).
-- drive_parent_id: pasta do Drive de onde o arquivo veio (pra saber se sumiu de lá).
-- drive_missing: o arquivo não está mais na pasta ligada do Drive (não apaga o criativo).
ALTER TABLE public.product_creatives
  ADD COLUMN IF NOT EXISTS folder_id uuid REFERENCES public.product_creative_folders(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS drive_parent_id text,
  ADD COLUMN IF NOT EXISTS drive_missing boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS product_creatives_folder_idx ON public.product_creatives (folder_id);

-- Pasta "Criativos" do Drive ligada ao produto (link colado uma vez).
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS creatives_drive_folder_id text,
  ADD COLUMN IF NOT EXISTS creatives_drive_folder_name text,
  ADD COLUMN IF NOT EXISTS creatives_drive_synced_at timestamptz;

-- Modelo de nomes: {{pasta}} logo depois do nome do criativo no nome do anúncio
-- (AD1 do Preto e AD1 do Branco saem diferentes). Sem pasta, o código some do nome.
UPDATE public.naming_templates
SET levels = jsonb_set(levels, '{ad}', to_jsonb(
      CASE WHEN levels->>'ad' LIKE '%{{nome_do_criativo}}%'
           THEN replace(levels->>'ad', '{{nome_do_criativo}}', '{{nome_do_criativo}}_{{pasta}}')
           ELSE coalesce(nullif(levels->>'ad', ''), '{{nome_do_criativo}}') || '_{{pasta}}' END)),
    updated_at = now()
WHERE levels->>'v' = '2' AND coalesce(levels->>'ad', '') NOT LIKE '%{{pasta}}%';
