
-- Task lists table
CREATE TABLE public.task_lists (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT 'oklch(0.6 0.22 285)',
  icon TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  shop_id UUID REFERENCES public.shops(id) ON DELETE CASCADE,
  is_system BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX task_lists_shop_unique ON public.task_lists(shop_id) WHERE shop_id IS NOT NULL;
CREATE INDEX task_lists_user_idx ON public.task_lists(user_id);

ALTER TABLE public.task_lists ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own task_lists all" ON public.task_lists
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER set_task_lists_updated_at
  BEFORE UPDATE ON public.task_lists
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Add list_id to tasks
ALTER TABLE public.tasks
  ADD COLUMN list_id UUID REFERENCES public.task_lists(id) ON DELETE SET NULL;

CREATE INDEX tasks_list_idx ON public.tasks(list_id);

-- Seed defaults + per-shop lists for each existing user
DO $$
DECLARE
  u RECORD;
  s RECORD;
  i INTEGER;
  default_names TEXT[] := ARRAY['Pessoal','Financeiro','Tráfego','Operacional','Conteúdo'];
  default_colors TEXT[] := ARRAY[
    'oklch(0.6 0.22 285)',
    'oklch(0.62 0.14 155)',
    'oklch(0.7 0.14 75)',
    'oklch(0.65 0.14 195)',
    'oklch(0.65 0.16 25)'
  ];
BEGIN
  FOR u IN SELECT id FROM auth.users LOOP
    FOR i IN 1..array_length(default_names, 1) LOOP
      INSERT INTO public.task_lists (user_id, name, color, position, is_system)
      VALUES (u.id, default_names[i], default_colors[i], i - 1, i = 1);
    END LOOP;

    FOR s IN SELECT id, name, position FROM public.shops WHERE user_id = u.id LOOP
      INSERT INTO public.task_lists (user_id, name, color, position, shop_id)
      VALUES (u.id, s.name, 'oklch(0.62 0.14 195)', 100 + s.position, s.id);
    END LOOP;
  END LOOP;
END $$;

-- Trigger: auto-create list when a shop is created
CREATE OR REPLACE FUNCTION public.handle_new_shop_create_list()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.task_lists (user_id, name, color, position, shop_id)
  VALUES (NEW.user_id, NEW.name, 'oklch(0.62 0.14 195)', 100 + COALESCE(NEW.position, 0), NEW.id);
  RETURN NEW;
END;
$$;

CREATE TRIGGER shops_create_task_list
  AFTER INSERT ON public.shops
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_shop_create_list();

-- Trigger: keep list name in sync when shop name changes
CREATE OR REPLACE FUNCTION public.handle_shop_name_sync()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.name IS DISTINCT FROM OLD.name THEN
    UPDATE public.task_lists SET name = NEW.name WHERE shop_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER shops_sync_task_list_name
  AFTER UPDATE ON public.shops
  FOR EACH ROW EXECUTE FUNCTION public.handle_shop_name_sync();

-- Add list creation to handle_new_user (so new signups get defaults)
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, avatar_url)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)),
    NEW.raw_user_meta_data->>'avatar_url'
  );

  INSERT INTO public.stores (user_id, name, color, position) VALUES
    (NEW.id, 'Walkesty',    'oklch(0.6 0.22 285)',  0),
    (NEW.id, 'The Ravien',  'oklch(0.62 0.14 155)', 1),
    (NEW.id, 'The Kickest', 'oklch(0.7 0.14 75)',   2);

  INSERT INTO public.categories (user_id, name, kind, color) VALUES
    (NEW.id, 'Vendas',        'income',  'oklch(0.62 0.14 155)'),
    (NEW.id, 'Recebimentos',  'income',  'oklch(0.65 0.14 195)'),
    (NEW.id, 'Investimentos', 'income',  'oklch(0.6 0.22 285)'),
    (NEW.id, 'Ferramentas',   'expense', 'oklch(0.7 0.14 75)'),
    (NEW.id, 'Pessoal',       'expense', 'oklch(0.65 0.16 25)'),
    (NEW.id, 'Impostos',      'expense', 'oklch(0.55 0.16 0)'),
    (NEW.id, 'Outros',        'expense', 'oklch(0.62 0.012 270)');

  INSERT INTO public.fx_rates (user_id, usd_to_brl) VALUES (NEW.id, 5.0);

  INSERT INTO public.task_lists (user_id, name, color, position, is_system) VALUES
    (NEW.id, 'Pessoal',     'oklch(0.6 0.22 285)',  0, true),
    (NEW.id, 'Financeiro',  'oklch(0.62 0.14 155)', 1, false),
    (NEW.id, 'Tráfego',     'oklch(0.7 0.14 75)',   2, false),
    (NEW.id, 'Operacional', 'oklch(0.65 0.14 195)', 3, false),
    (NEW.id, 'Conteúdo',    'oklch(0.65 0.16 25)',  4, false);

  RETURN NEW;
END;
$$;
