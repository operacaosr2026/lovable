-- Atendimento › Imagens: banco com todas as imagens que os clientes mandaram
-- (anexo ou colada no corpo do e-mail). O cron do Zoho copia cada uma pro
-- bucket support-images (o Zoho só abre logado e pode apagar) e indexa aqui.
-- Mesma foto reenviada na conversa (iPhone repete no histórico) entra uma vez
-- só: content_hash único por conversa.
-- support_messages.images_scanned_at: e-mail já olhado; images_attempts: falhas
-- seguidas no Zoho (desiste na 3ª).
-- Acesso só pelo servidor (service role): RLS ligado e sem policies.

CREATE TABLE IF NOT EXISTS public.support_images (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id         uuid NOT NULL,
  conversation_id  uuid NOT NULL REFERENCES public.support_conversations(id) ON DELETE CASCADE,
  message_id       uuid NOT NULL REFERENCES public.support_messages(id) ON DELETE CASCADE,
  source           text NOT NULL CHECK (source IN ('anexo', 'inline')),
  ref              text NOT NULL,
  file_name        text,
  mime             text,
  size             integer NOT NULL DEFAULT 0,
  content_hash     text NOT NULL,
  storage_path     text NOT NULL,
  customer_email   text,
  customer_name    text,
  subject          text,
  shop_id          uuid,
  sent_at          timestamptz NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS support_images_conv_hash_idx ON public.support_images (conversation_id, content_hash);
CREATE INDEX IF NOT EXISTS support_images_owner_sent_idx ON public.support_images (owner_id, sent_at DESC);

ALTER TABLE public.support_images ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.support_images TO service_role;

ALTER TABLE public.support_messages
  ADD COLUMN IF NOT EXISTS images_scanned_at timestamptz,
  ADD COLUMN IF NOT EXISTS images_attempts smallint NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS support_messages_images_pending_idx ON public.support_messages (owner_id, sent_at DESC)
  WHERE direction = 'in' AND images_scanned_at IS NULL;

INSERT INTO storage.buckets (id, name, public) VALUES ('support-images', 'support-images', false)
ON CONFLICT (id) DO NOTHING;
