
-- inboxes additions
ALTER TABLE public.support_inboxes
  ADD COLUMN IF NOT EXISTS webhook_secret text NOT NULL DEFAULT encode(gen_random_bytes(24), 'hex'),
  ADD COLUMN IF NOT EXISTS last_uid_seen bigint,
  ADD COLUMN IF NOT EXISTS last_poll_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_poll_status text,
  ADD COLUMN IF NOT EXISTS last_poll_error text,
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS poll_interval_sec integer NOT NULL DEFAULT 180;

-- messages additions
ALTER TABLE public.support_messages
  ADD COLUMN IF NOT EXISTS to_emails text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS cc_emails text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS subject text,
  ADD COLUMN IF NOT EXISTS attachments jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS references_header text,
  ADD COLUMN IF NOT EXISTS error_message text,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'delivered';

CREATE UNIQUE INDEX IF NOT EXISTS support_messages_external_unique
  ON public.support_messages (conversation_id, external_message_id)
  WHERE external_message_id IS NOT NULL;

-- conversations additions
ALTER TABLE public.support_conversations
  ADD COLUMN IF NOT EXISTS thread_key text;

CREATE INDEX IF NOT EXISTS support_conversations_thread_idx
  ON public.support_conversations (inbox_id, thread_key);

-- outbound queue
CREATE TABLE IF NOT EXISTS public.support_outbound_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  inbox_id uuid NOT NULL REFERENCES public.support_inboxes(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES public.support_conversations(id) ON DELETE CASCADE,
  message_id uuid REFERENCES public.support_messages(id) ON DELETE SET NULL,
  to_emails text[] NOT NULL,
  cc_emails text[] NOT NULL DEFAULT '{}',
  subject text NOT NULL DEFAULT '',
  body_html text NOT NULL DEFAULT '',
  body_text text NOT NULL DEFAULT '',
  in_reply_to text,
  references_header text,
  status text NOT NULL DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.support_outbound_queue TO authenticated;
GRANT ALL ON public.support_outbound_queue TO service_role;

ALTER TABLE public.support_outbound_queue ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "own outbound" ON public.support_outbound_queue;
CREATE POLICY "own outbound"
  ON public.support_outbound_queue
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS support_outbound_pending_idx
  ON public.support_outbound_queue (status, created_at)
  WHERE status = 'pending';

DROP TRIGGER IF EXISTS support_outbound_queue_updated_at ON public.support_outbound_queue;
CREATE TRIGGER support_outbound_queue_updated_at
  BEFORE UPDATE ON public.support_outbound_queue
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
