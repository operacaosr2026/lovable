-- Aba Diário do produto (ideia do diário de campanha do Scalemoon): registros
-- com data, tipo de nota e imagens; "Teste atual" e "Última alteração" no topo.
-- Tipos de nota valem pro workspace todo; "Alteração" é fixo (is_system) e é
-- o que alimenta "Última alteração".
-- Acesso só pelo servidor (service role): RLS ligado e sem policies.

CREATE TABLE IF NOT EXISTS public.product_diary_note_types (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL,                  -- dono do workspace
  name       text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 40),
  color      text NOT NULL DEFAULT 'blue',
  position   integer NOT NULL DEFAULT 0,
  is_system  boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS product_diary_note_types_user_idx ON public.product_diary_note_types (user_id);
CREATE UNIQUE INDEX IF NOT EXISTS product_diary_note_types_system_uidx
  ON public.product_diary_note_types (user_id) WHERE is_system;

CREATE TABLE IF NOT EXISTS public.product_diary_entries (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL,                -- dono do workspace
  product_id   uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  note_type_id uuid REFERENCES public.product_diary_note_types(id) ON DELETE SET NULL,
  author_id    uuid,
  content      text NOT NULL CHECK (char_length(content) BETWEEN 1 AND 10000),
  image_urls   jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at   timestamptz NOT NULL DEFAULT now(),
  edited_at    timestamptz
);
CREATE INDEX IF NOT EXISTS product_diary_entries_product_idx
  ON public.product_diary_entries (user_id, product_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.product_diary_focus (
  product_id   uuid PRIMARY KEY REFERENCES public.products(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL,
  current_test text CHECK (char_length(current_test) <= 2000),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.product_diary_note_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_diary_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_diary_focus ENABLE ROW LEVEL SECURITY;
