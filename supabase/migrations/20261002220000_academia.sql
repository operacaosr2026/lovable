-- Academia SRX: trilhas de treinamento com aulas de vários tipos
-- (documento, vídeo, fluxograma, mapa mental, arquivo) e progresso por pessoa.
--  - trilhas e aulas: um conjunto por dono do workspace;
--  - content da aula: depende do tipo — doc {blocks}, video {url | path},
--    flow/mindmap {nodes, edges}, file {path, name, size, mime};
--  - progresso: aula concluída por membro;
--  - arquivos (vídeos, PDFs, imagens dos documentos) no bucket privado training.
-- Acesso só pelo servidor (service role): RLS ligado e sem policies.

-- Mesma função das outras tabelas; recriada aqui pra migração não depender dela.
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TABLE IF NOT EXISTS public.training_tracks (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL,                  -- dono do workspace
  title       text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 120),
  description text CHECK (char_length(description) <= 2000),
  color       text NOT NULL DEFAULT '#6366f1',
  emoji       text CHECK (char_length(emoji) <= 16),
  position    integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS training_tracks_user_idx ON public.training_tracks (user_id, position);

CREATE TABLE IF NOT EXISTS public.training_lessons (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL,
  track_id     uuid NOT NULL REFERENCES public.training_tracks(id) ON DELETE CASCADE,
  title        text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  kind         text NOT NULL CHECK (kind IN ('doc', 'video', 'flow', 'mindmap', 'file')),
  content      jsonb NOT NULL DEFAULT '{}'::jsonb,
  duration_min integer CHECK (duration_min BETWEEN 0 AND 1440),
  position     integer NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS training_lessons_track_idx ON public.training_lessons (track_id, position);

CREATE TABLE IF NOT EXISTS public.training_progress (
  member_id    uuid NOT NULL,
  lesson_id    uuid NOT NULL REFERENCES public.training_lessons(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL,
  completed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (member_id, lesson_id)
);
CREATE INDEX IF NOT EXISTS training_progress_user_idx ON public.training_progress (user_id);

DROP TRIGGER IF EXISTS training_tracks_updated_at ON public.training_tracks;
CREATE TRIGGER training_tracks_updated_at BEFORE UPDATE ON public.training_tracks
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS training_lessons_updated_at ON public.training_lessons;
CREATE TRIGGER training_lessons_updated_at BEFORE UPDATE ON public.training_lessons
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.training_tracks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.training_lessons ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.training_progress ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.training_tracks TO service_role;
GRANT ALL ON public.training_lessons TO service_role;
GRANT ALL ON public.training_progress TO service_role;

-- Upload direto do navegador por URL assinada; leitura também por URL
-- assinada gerada no servidor.
INSERT INTO storage.buckets (id, name, public) VALUES ('training', 'training', false)
ON CONFLICT (id) DO NOTHING;
