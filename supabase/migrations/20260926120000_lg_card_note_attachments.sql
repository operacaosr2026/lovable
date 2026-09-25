-- Anexos das notas do Diário de Operação (grupo em Lojas e Grupos). O arquivo
-- fica no bucket privado project-attachments (pasta de quem enviou, como exigem
-- as policies do bucket); os links são gerados pelo servidor, então qualquer
-- pessoa do workspace vê. Apagar a nota apaga os anexos (cascade + storage no servidor).

CREATE TABLE IF NOT EXISTS public.lg_card_note_attachments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL,              -- dono do workspace
  note_id     uuid NOT NULL REFERENCES public.lg_card_notes(id) ON DELETE CASCADE,
  file_name   text NOT NULL,
  file_path   text NOT NULL,
  mime_type   text,
  size_bytes  bigint,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS lg_card_note_attachments_note_idx ON public.lg_card_note_attachments (note_id);
ALTER TABLE public.lg_card_note_attachments ENABLE ROW LEVEL SECURITY;
-- Sem policy: só o servidor (service role) lê e grava, sempre filtrando pelo dono.
