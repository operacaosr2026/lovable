
-- ============ support_inboxes ============
CREATE TABLE public.support_inboxes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  shop_id UUID NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
  email_address TEXT NOT NULL,
  display_name TEXT,
  provider TEXT NOT NULL DEFAULT 'imap_smtp',
  imap_host TEXT,
  imap_port INTEGER DEFAULT 993,
  imap_user TEXT,
  imap_password TEXT,
  imap_ssl BOOLEAN DEFAULT true,
  smtp_host TEXT,
  smtp_port INTEGER DEFAULT 465,
  smtp_user TEXT,
  smtp_password TEXT,
  smtp_ssl BOOLEAN DEFAULT true,
  connection_status TEXT NOT NULL DEFAULT 'disconnected',
  last_sync_at TIMESTAMPTZ,
  last_error TEXT,
  sla_warning_hours INTEGER NOT NULL DEFAULT 2,
  sla_critical_hours INTEGER NOT NULL DEFAULT 12,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(shop_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.support_inboxes TO authenticated;
GRANT ALL ON public.support_inboxes TO service_role;
ALTER TABLE public.support_inboxes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own inboxes" ON public.support_inboxes FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Protect credentials: revoke column access from client roles
REVOKE SELECT (imap_password, smtp_password), INSERT (imap_password, smtp_password), UPDATE (imap_password, smtp_password)
  ON public.support_inboxes FROM authenticated, anon;

-- ============ support_ticket_statuses ============
CREATE TABLE public.support_ticket_statuses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT 'oklch(0.6 0.05 250)',
  position INTEGER NOT NULL DEFAULT 0,
  is_system BOOLEAN NOT NULL DEFAULT false,
  system_key TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.support_ticket_statuses TO authenticated;
GRANT ALL ON public.support_ticket_statuses TO service_role;
ALTER TABLE public.support_ticket_statuses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own statuses" ON public.support_ticket_statuses FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ============ support_customers ============
CREATE TABLE public.support_customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  name TEXT,
  priority_tag TEXT,
  notes TEXT,
  orders_count INTEGER NOT NULL DEFAULT 0,
  total_spent NUMERIC NOT NULL DEFAULT 0,
  linked_shop_id UUID REFERENCES public.shops(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, email)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.support_customers TO authenticated;
GRANT ALL ON public.support_customers TO service_role;
ALTER TABLE public.support_customers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own customers" ON public.support_customers FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ============ support_conversations ============
CREATE TABLE public.support_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  inbox_id UUID NOT NULL REFERENCES public.support_inboxes(id) ON DELETE CASCADE,
  shop_id UUID NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES public.support_customers(id) ON DELETE CASCADE,
  subject TEXT,
  status_id UUID REFERENCES public.support_ticket_statuses(id) ON DELETE SET NULL,
  linked_order_id UUID REFERENCES public.shop_orders(id) ON DELETE SET NULL,
  linked_order_external_id TEXT,
  is_unidentified BOOLEAN NOT NULL DEFAULT false,
  assigned_to UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  last_message_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_message_from TEXT NOT NULL DEFAULT 'customer',
  first_customer_message_at TIMESTAMPTZ,
  first_response_at TIMESTAMPTZ,
  first_response_seconds INTEGER,
  unread_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.support_conversations TO authenticated;
GRANT ALL ON public.support_conversations TO service_role;
ALTER TABLE public.support_conversations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own conversations" ON public.support_conversations FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX support_conversations_inbox_idx ON public.support_conversations(inbox_id, last_message_at DESC);
CREATE INDEX support_conversations_customer_idx ON public.support_conversations(customer_id);

-- ============ support_messages ============
CREATE TABLE public.support_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL REFERENCES public.support_conversations(id) ON DELETE CASCADE,
  direction TEXT NOT NULL,
  from_email TEXT,
  from_name TEXT,
  body_text TEXT NOT NULL DEFAULT '',
  body_html TEXT,
  external_message_id TEXT,
  in_reply_to TEXT,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  is_read BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.support_messages TO authenticated;
GRANT ALL ON public.support_messages TO service_role;
ALTER TABLE public.support_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own messages" ON public.support_messages FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX support_messages_conv_idx ON public.support_messages(conversation_id, sent_at);

-- ============ support_reply_templates ============
CREATE TABLE public.support_reply_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  shop_id UUID REFERENCES public.shops(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  shortcut TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.support_reply_templates TO authenticated;
GRANT ALL ON public.support_reply_templates TO service_role;
ALTER TABLE public.support_reply_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own templates" ON public.support_reply_templates FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ============ updated_at triggers ============
CREATE TRIGGER support_inboxes_updated_at BEFORE UPDATE ON public.support_inboxes
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER support_ticket_statuses_updated_at BEFORE UPDATE ON public.support_ticket_statuses
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER support_customers_updated_at BEFORE UPDATE ON public.support_customers
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER support_conversations_updated_at BEFORE UPDATE ON public.support_conversations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER support_reply_templates_updated_at BEFORE UPDATE ON public.support_reply_templates
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============ Seed system statuses for existing users ============
INSERT INTO public.support_ticket_statuses (user_id, name, color, position, is_system, system_key)
SELECT u.id, s.name, s.color, s.position, true, s.key
FROM auth.users u
CROSS JOIN (VALUES
  ('open',            'Aberto',                'oklch(0.65 0.14 195)', 0),
  ('in_progress',     'Em andamento',          'oklch(0.7 0.14 75)',   1),
  ('waiting_customer','Aguardando cliente',    'oklch(0.62 0.012 270)',2),
  ('resolved',        'Resolvido',             'oklch(0.62 0.14 155)', 3),
  ('unidentified',    'Sem pedido vinculado',  'oklch(0.65 0.16 25)',  4)
) AS s(key, name, color, position)
ON CONFLICT DO NOTHING;

-- Trigger to seed statuses for new users
CREATE OR REPLACE FUNCTION public.handle_new_user_support_seed()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.support_ticket_statuses (user_id, name, color, position, is_system, system_key) VALUES
    (NEW.id, 'Aberto',                'oklch(0.65 0.14 195)', 0, true, 'open'),
    (NEW.id, 'Em andamento',          'oklch(0.7 0.14 75)',   1, true, 'in_progress'),
    (NEW.id, 'Aguardando cliente',    'oklch(0.62 0.012 270)',2, true, 'waiting_customer'),
    (NEW.id, 'Resolvido',             'oklch(0.62 0.14 155)', 3, true, 'resolved'),
    (NEW.id, 'Sem pedido vinculado',  'oklch(0.65 0.16 25)',  4, true, 'unidentified')
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END; $$;
