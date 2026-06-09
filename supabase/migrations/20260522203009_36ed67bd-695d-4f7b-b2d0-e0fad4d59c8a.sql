
-- ===== Roles =====
CREATE TYPE public.app_role AS ENUM ('admin', 'member');

CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL DEFAULT 'member',
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

CREATE POLICY "users see own role" ON public.user_roles FOR SELECT USING (auth.uid() = user_id);

-- ===== Workspace membership =====
CREATE TABLE public.workspace_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  member_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, member_id)
);
ALTER TABLE public.workspace_members ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_workspace_members_member ON public.workspace_members(member_id);
CREATE INDEX idx_workspace_members_owner ON public.workspace_members(owner_id);

CREATE POLICY "owner manages workspace_members" ON public.workspace_members FOR ALL
  USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);
CREATE POLICY "member sees own link" ON public.workspace_members FOR SELECT
  USING (auth.uid() = member_id);

-- ===== Invitations =====
CREATE TABLE public.member_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  email text NOT NULL,
  token text NOT NULL UNIQUE,
  permissions jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'pending',
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
  accepted_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.member_invitations ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_member_invitations_token ON public.member_invitations(token);

CREATE POLICY "owner manages own invitations" ON public.member_invitations FOR ALL
  USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);

-- ===== Permissions =====
CREATE TABLE public.member_permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  member_id uuid NOT NULL,
  section text NOT NULL,
  resource_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uniq_member_perm ON public.member_permissions(owner_id, member_id, section, COALESCE(resource_id, '00000000-0000-0000-0000-000000000000'::uuid));
CREATE INDEX idx_member_perm_member ON public.member_permissions(member_id, section);
ALTER TABLE public.member_permissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "owner manages perms" ON public.member_permissions FOR ALL
  USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);
CREATE POLICY "member reads own perms" ON public.member_permissions FOR SELECT
  USING (auth.uid() = member_id);

-- ===== Access helper =====
CREATE OR REPLACE FUNCTION public.has_workspace_access(_member uuid, _owner uuid, _section text, _resource uuid DEFAULT NULL)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.workspace_members wm
    WHERE wm.owner_id = _owner AND wm.member_id = _member
  ) AND EXISTS (
    SELECT 1 FROM public.member_permissions p
    WHERE p.owner_id = _owner
      AND p.member_id = _member
      AND p.section = _section
      AND (p.resource_id IS NULL OR _resource IS NULL OR p.resource_id = _resource)
  )
$$;

-- ===== Update handle_new_user =====
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_invite_token text;
  v_invite RECORD;
BEGIN
  INSERT INTO public.profiles (id, full_name, avatar_url)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)),
    NEW.raw_user_meta_data->>'avatar_url'
  );

  v_invite_token := NEW.raw_user_meta_data->>'invite_token';

  IF v_invite_token IS NOT NULL THEN
    SELECT * INTO v_invite FROM public.member_invitations
    WHERE token = v_invite_token AND status = 'pending' AND expires_at > now()
    LIMIT 1;

    IF FOUND THEN
      INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'member')
        ON CONFLICT (user_id) DO NOTHING;
      INSERT INTO public.workspace_members (owner_id, member_id) VALUES (v_invite.owner_id, NEW.id)
        ON CONFLICT DO NOTHING;

      INSERT INTO public.member_permissions (owner_id, member_id, section, resource_id)
      SELECT v_invite.owner_id, NEW.id,
             (p->>'section')::text,
             NULLIF(p->>'resource_id','')::uuid
      FROM jsonb_array_elements(v_invite.permissions) p
      ON CONFLICT DO NOTHING;

      UPDATE public.member_invitations
      SET status = 'accepted', accepted_by = NEW.id
      WHERE id = v_invite.id;

      RETURN NEW;
    END IF;
  END IF;

  -- Regular admin signup
  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'admin')
    ON CONFLICT (user_id) DO NOTHING;

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

-- ===== Backfill: existing users become admin =====
INSERT INTO public.user_roles (user_id, role)
SELECT id, 'admin'::public.app_role FROM auth.users
ON CONFLICT (user_id) DO NOTHING;

-- ===== Member access policies on app tables =====

-- shops (resource: id)
CREATE POLICY "members access shops" ON public.shops FOR ALL
  USING (public.has_workspace_access(auth.uid(), user_id, 'shops', id))
  WITH CHECK (public.has_workspace_access(auth.uid(), user_id, 'shops', id));

-- shop-dependent tables (resource: shop_id)
CREATE POLICY "members access shop_tasks" ON public.shop_tasks FOR ALL
  USING (public.has_workspace_access(auth.uid(), user_id, 'shops', shop_id))
  WITH CHECK (public.has_workspace_access(auth.uid(), user_id, 'shops', shop_id));

CREATE POLICY "members access shop_routines" ON public.shop_routines FOR ALL
  USING (public.has_workspace_access(auth.uid(), user_id, 'shops', shop_id))
  WITH CHECK (public.has_workspace_access(auth.uid(), user_id, 'shops', shop_id));

CREATE POLICY "members access shop_cash_categories" ON public.shop_cash_categories FOR ALL
  USING (public.has_workspace_access(auth.uid(), user_id, 'shops', shop_id))
  WITH CHECK (public.has_workspace_access(auth.uid(), user_id, 'shops', shop_id));

CREATE POLICY "members access shop_cash_entries" ON public.shop_cash_entries FOR ALL
  USING (public.has_workspace_access(auth.uid(), user_id, 'shops', shop_id))
  WITH CHECK (public.has_workspace_access(auth.uid(), user_id, 'shops', shop_id));

CREATE POLICY "members access shop_cash_imports" ON public.shop_cash_imports FOR ALL
  USING (public.has_workspace_access(auth.uid(), user_id, 'shops', shop_id))
  WITH CHECK (public.has_workspace_access(auth.uid(), user_id, 'shops', shop_id));

CREATE POLICY "members access shop_orders" ON public.shop_orders FOR ALL
  USING (public.has_workspace_access(auth.uid(), user_id, 'shops', shop_id))
  WITH CHECK (public.has_workspace_access(auth.uid(), user_id, 'shops', shop_id));

CREATE POLICY "members access shop_order_settings" ON public.shop_order_settings FOR ALL
  USING (public.has_workspace_access(auth.uid(), user_id, 'shops', shop_id))
  WITH CHECK (public.has_workspace_access(auth.uid(), user_id, 'shops', shop_id));

CREATE POLICY "members access shop_products" ON public.shop_products FOR ALL
  USING (public.has_workspace_access(auth.uid(), user_id, 'shops', shop_id))
  WITH CHECK (public.has_workspace_access(auth.uid(), user_id, 'shops', shop_id));

CREATE POLICY "members access shop_product_cost_history" ON public.shop_product_cost_history FOR ALL
  USING (public.has_workspace_access(auth.uid(), user_id, 'shops', shop_id))
  WITH CHECK (public.has_workspace_access(auth.uid(), user_id, 'shops', shop_id));

-- Loose shop-related (no shop_id column, fall back to section)
CREATE POLICY "members access stores" ON public.stores FOR ALL
  USING (public.has_workspace_access(auth.uid(), user_id, 'shops', NULL))
  WITH CHECK (public.has_workspace_access(auth.uid(), user_id, 'shops', NULL));

CREATE POLICY "members access store_revenues" ON public.store_revenues FOR ALL
  USING (public.has_workspace_access(auth.uid(), user_id, 'shops', NULL))
  WITH CHECK (public.has_workspace_access(auth.uid(), user_id, 'shops', NULL));

CREATE POLICY "members access shop_task_comments" ON public.shop_task_comments FOR ALL
  USING (public.has_workspace_access(auth.uid(), user_id, 'shops', NULL))
  WITH CHECK (public.has_workspace_access(auth.uid(), user_id, 'shops', NULL));

CREATE POLICY "members access shop_task_attachments" ON public.shop_task_attachments FOR ALL
  USING (public.has_workspace_access(auth.uid(), user_id, 'shops', NULL))
  WITH CHECK (public.has_workspace_access(auth.uid(), user_id, 'shops', NULL));

CREATE POLICY "members access shop_routine_logs" ON public.shop_routine_logs FOR ALL
  USING (public.has_workspace_access(auth.uid(), user_id, 'shops', NULL))
  WITH CHECK (public.has_workspace_access(auth.uid(), user_id, 'shops', NULL));

CREATE POLICY "members access shop_product_attachments" ON public.shop_product_attachments FOR ALL
  USING (public.has_workspace_access(auth.uid(), user_id, 'shops', NULL))
  WITH CHECK (public.has_workspace_access(auth.uid(), user_id, 'shops', NULL));

-- products area (catalog) - tied to 'shops' section
CREATE POLICY "members access products" ON public.products FOR ALL
  USING (public.has_workspace_access(auth.uid(), user_id, 'shops', NULL))
  WITH CHECK (public.has_workspace_access(auth.uid(), user_id, 'shops', NULL));

CREATE POLICY "members access product_images" ON public.product_images FOR ALL
  USING (public.has_workspace_access(auth.uid(), user_id, 'shops', NULL))
  WITH CHECK (public.has_workspace_access(auth.uid(), user_id, 'shops', NULL));

CREATE POLICY "members access product_creatives" ON public.product_creatives FOR ALL
  USING (public.has_workspace_access(auth.uid(), user_id, 'shops', NULL))
  WITH CHECK (public.has_workspace_access(auth.uid(), user_id, 'shops', NULL));

CREATE POLICY "members access product_pricing" ON public.product_pricing FOR ALL
  USING (public.has_workspace_access(auth.uid(), user_id, 'shops', NULL))
  WITH CHECK (public.has_workspace_access(auth.uid(), user_id, 'shops', NULL));

CREATE POLICY "members access product_templates" ON public.product_templates FOR ALL
  USING (public.has_workspace_access(auth.uid(), user_id, 'shops', NULL))
  WITH CHECK (public.has_workspace_access(auth.uid(), user_id, 'shops', NULL));

-- projects (resource: id)
CREATE POLICY "members access projects" ON public.projects FOR ALL
  USING (public.has_workspace_access(auth.uid(), user_id, 'projects', id))
  WITH CHECK (public.has_workspace_access(auth.uid(), user_id, 'projects', id));

CREATE POLICY "members access project_tasks" ON public.project_tasks FOR ALL
  USING (public.has_workspace_access(auth.uid(), user_id, 'projects', project_id))
  WITH CHECK (public.has_workspace_access(auth.uid(), user_id, 'projects', project_id));

CREATE POLICY "members access project_notes" ON public.project_notes FOR ALL
  USING (public.has_workspace_access(auth.uid(), user_id, 'projects', project_id))
  WITH CHECK (public.has_workspace_access(auth.uid(), user_id, 'projects', project_id));

CREATE POLICY "members access project_attachments" ON public.project_attachments FOR ALL
  USING (public.has_workspace_access(auth.uid(), user_id, 'projects', project_id))
  WITH CHECK (public.has_workspace_access(auth.uid(), user_id, 'projects', project_id));

-- journal
CREATE POLICY "members access journal_pages" ON public.journal_pages FOR ALL
  USING (public.has_workspace_access(auth.uid(), user_id, 'journal', id))
  WITH CHECK (public.has_workspace_access(auth.uid(), user_id, 'journal', id));

CREATE POLICY "members access gratitude_entries" ON public.gratitude_entries FOR ALL
  USING (public.has_workspace_access(auth.uid(), user_id, 'journal', NULL))
  WITH CHECK (public.has_workspace_access(auth.uid(), user_id, 'journal', NULL));

-- tasks
CREATE POLICY "members access task_lists" ON public.task_lists FOR ALL
  USING (public.has_workspace_access(auth.uid(), user_id, 'tasks', id))
  WITH CHECK (public.has_workspace_access(auth.uid(), user_id, 'tasks', id));

CREATE POLICY "members access tasks" ON public.tasks FOR ALL
  USING (public.has_workspace_access(auth.uid(), user_id, 'tasks', list_id))
  WITH CHECK (public.has_workspace_access(auth.uid(), user_id, 'tasks', list_id));

CREATE POLICY "members access task_attachments" ON public.task_attachments FOR ALL
  USING (public.has_workspace_access(auth.uid(), user_id, 'tasks', NULL))
  WITH CHECK (public.has_workspace_access(auth.uid(), user_id, 'tasks', NULL));

CREATE POLICY "members access task_completion_logs" ON public.task_completion_logs FOR ALL
  USING (public.has_workspace_access(auth.uid(), user_id, 'tasks', NULL))
  WITH CHECK (public.has_workspace_access(auth.uid(), user_id, 'tasks', NULL));

CREATE POLICY "members access task_notifications" ON public.task_notifications FOR ALL
  USING (public.has_workspace_access(auth.uid(), user_id, 'tasks', NULL))
  WITH CHECK (public.has_workspace_access(auth.uid(), user_id, 'tasks', NULL));

-- whiteboard
CREATE POLICY "members access whiteboard_nodes" ON public.whiteboard_nodes FOR ALL
  USING (public.has_workspace_access(auth.uid(), user_id, 'whiteboard', board_id))
  WITH CHECK (public.has_workspace_access(auth.uid(), user_id, 'whiteboard', board_id));

CREATE POLICY "members access whiteboard_edges" ON public.whiteboard_edges FOR ALL
  USING (public.has_workspace_access(auth.uid(), user_id, 'whiteboard', board_id))
  WITH CHECK (public.has_workspace_access(auth.uid(), user_id, 'whiteboard', board_id));

-- kanban_columns (boards)
CREATE POLICY "members access kanban_columns" ON public.kanban_columns FOR ALL
  USING (
    (board_type = 'shops_pipeline' AND public.has_workspace_access(auth.uid(), user_id, 'shops', NULL))
    OR (board_type LIKE 'project%' AND public.has_workspace_access(auth.uid(), user_id, 'projects', NULL))
    OR public.has_workspace_access(auth.uid(), user_id, 'shops', NULL)
  )
  WITH CHECK (
    (board_type = 'shops_pipeline' AND public.has_workspace_access(auth.uid(), user_id, 'shops', NULL))
    OR (board_type LIKE 'project%' AND public.has_workspace_access(auth.uid(), user_id, 'projects', NULL))
    OR public.has_workspace_access(auth.uid(), user_id, 'shops', NULL)
  );

-- sops
CREATE POLICY "members access sop_processes" ON public.sop_processes FOR ALL
  USING (public.has_workspace_access(auth.uid(), user_id, 'sops', id))
  WITH CHECK (public.has_workspace_access(auth.uid(), user_id, 'sops', id));

CREATE POLICY "members access sop_steps" ON public.sop_steps FOR ALL
  USING (public.has_workspace_access(auth.uid(), user_id, 'sops', process_id))
  WITH CHECK (public.has_workspace_access(auth.uid(), user_id, 'sops', process_id));

CREATE POLICY "members access sop_edges" ON public.sop_edges FOR ALL
  USING (public.has_workspace_access(auth.uid(), user_id, 'sops', process_id))
  WITH CHECK (public.has_workspace_access(auth.uid(), user_id, 'sops', process_id));

CREATE POLICY "members access sop_step_comments" ON public.sop_step_comments FOR ALL
  USING (public.has_workspace_access(auth.uid(), user_id, 'sops', NULL))
  WITH CHECK (public.has_workspace_access(auth.uid(), user_id, 'sops', NULL));

-- finance
CREATE POLICY "members access accounts" ON public.accounts FOR ALL
  USING (public.has_workspace_access(auth.uid(), user_id, 'finance', NULL))
  WITH CHECK (public.has_workspace_access(auth.uid(), user_id, 'finance', NULL));

CREATE POLICY "members access categories" ON public.categories FOR ALL
  USING (public.has_workspace_access(auth.uid(), user_id, 'finance', NULL))
  WITH CHECK (public.has_workspace_access(auth.uid(), user_id, 'finance', NULL));

CREATE POLICY "members access transactions" ON public.transactions FOR ALL
  USING (public.has_workspace_access(auth.uid(), user_id, 'finance', NULL))
  WITH CHECK (public.has_workspace_access(auth.uid(), user_id, 'finance', NULL));

CREATE POLICY "members access recurrences" ON public.recurrences FOR ALL
  USING (public.has_workspace_access(auth.uid(), user_id, 'finance', NULL))
  WITH CHECK (public.has_workspace_access(auth.uid(), user_id, 'finance', NULL));

CREATE POLICY "members access fx_rates" ON public.fx_rates FOR ALL
  USING (public.has_workspace_access(auth.uid(), user_id, 'finance', NULL))
  WITH CHECK (public.has_workspace_access(auth.uid(), user_id, 'finance', NULL));

CREATE POLICY "members access financial_goals" ON public.financial_goals FOR ALL
  USING (public.has_workspace_access(auth.uid(), user_id, 'finance', NULL))
  WITH CHECK (public.has_workspace_access(auth.uid(), user_id, 'finance', NULL));

-- habits
CREATE POLICY "members access habits" ON public.habits FOR ALL
  USING (public.has_workspace_access(auth.uid(), user_id, 'habits', NULL))
  WITH CHECK (public.has_workspace_access(auth.uid(), user_id, 'habits', NULL));

CREATE POLICY "members access habit_logs" ON public.habit_logs FOR ALL
  USING (public.has_workspace_access(auth.uid(), user_id, 'habits', NULL))
  WITH CHECK (public.has_workspace_access(auth.uid(), user_id, 'habits', NULL));
