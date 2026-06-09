
-- SHOPS
CREATE TABLE public.shops (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  name TEXT NOT NULL,
  logo_url TEXT,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'ativa',
  country TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  archived BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.shops ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own shops all" ON public.shops FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER set_shops_updated_at BEFORE UPDATE ON public.shops FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- SHOP PRODUCTS
CREATE TABLE public.shop_products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  shop_id UUID NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  image_url TEXT,
  description TEXT,
  links JSONB NOT NULL DEFAULT '[]'::jsonb,
  notes TEXT,
  tags TEXT[] NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'ideia',
  product_date DATE,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.shop_products ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own shop_products all" ON public.shop_products FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER set_shop_products_updated_at BEFORE UPDATE ON public.shop_products FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE INDEX idx_shop_products_shop ON public.shop_products(shop_id);

-- PRODUCT ATTACHMENTS
CREATE TABLE public.shop_product_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  product_id UUID NOT NULL REFERENCES public.shop_products(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  file_path TEXT NOT NULL,
  mime_type TEXT,
  size_bytes BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.shop_product_attachments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own shop_product_attachments all" ON public.shop_product_attachments FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- SHOP TASKS
CREATE TABLE public.shop_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  shop_id UUID NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
  parent_task_id UUID REFERENCES public.shop_tasks(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'todo',
  priority TEXT NOT NULL DEFAULT 'media',
  due_at TIMESTAMPTZ,
  checklist JSONB NOT NULL DEFAULT '[]'::jsonb,
  assignee TEXT,
  reminder_minutes INTEGER[] NOT NULL DEFAULT '{}',
  position INTEGER NOT NULL DEFAULT 0,
  done_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.shop_tasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own shop_tasks all" ON public.shop_tasks FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER set_shop_tasks_updated_at BEFORE UPDATE ON public.shop_tasks FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE INDEX idx_shop_tasks_shop ON public.shop_tasks(shop_id);

-- TASK ATTACHMENTS
CREATE TABLE public.shop_task_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  task_id UUID NOT NULL REFERENCES public.shop_tasks(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  file_path TEXT NOT NULL,
  mime_type TEXT,
  size_bytes BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.shop_task_attachments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own shop_task_attachments all" ON public.shop_task_attachments FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- TASK COMMENTS
CREATE TABLE public.shop_task_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  task_id UUID NOT NULL REFERENCES public.shop_tasks(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.shop_task_comments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own shop_task_comments all" ON public.shop_task_comments FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ROUTINES
CREATE TABLE public.shop_routines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  shop_id UUID NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  frequency TEXT NOT NULL DEFAULT 'daily',
  weekdays INTEGER[] NOT NULL DEFAULT '{}',
  time TEXT,
  reminder_minutes INTEGER[] NOT NULL DEFAULT '{}',
  due_at TIMESTAMPTZ,
  last_completed_at TIMESTAMPTZ,
  streak INTEGER NOT NULL DEFAULT 0,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.shop_routines ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own shop_routines all" ON public.shop_routines FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER set_shop_routines_updated_at BEFORE UPDATE ON public.shop_routines FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE INDEX idx_shop_routines_shop ON public.shop_routines(shop_id);

-- ROUTINE LOGS
CREATE TABLE public.shop_routine_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  routine_id UUID NOT NULL REFERENCES public.shop_routines(id) ON DELETE CASCADE,
  completed_on DATE NOT NULL DEFAULT CURRENT_DATE,
  completed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.shop_routine_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own shop_routine_logs all" ON public.shop_routine_logs FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX idx_shop_routine_logs_routine ON public.shop_routine_logs(routine_id);
