-- Permissão por aba do menu (Configurações > Membros). Membros que já existiam
-- continuam vendo o que viam: Dashboard, Metas e Tarefas eram abertas pra todos;
-- quem tinha "Lojas" (qualquer loja) via Produtos, Caixa, Banco de Lojas e
-- Lojas e Grupos. Projetos segue na permissão "projects" de antes.

INSERT INTO public.member_permissions (owner_id, member_id, section, resource_id)
SELECT wm.owner_id, wm.member_id, t.section, NULL
FROM public.workspace_members wm
CROSS JOIN (VALUES ('dashboard'), ('metas'), ('tarefas')) AS t(section)
WHERE NOT EXISTS (
  SELECT 1 FROM public.member_permissions p
  WHERE p.owner_id = wm.owner_id AND p.member_id = wm.member_id AND p.section = t.section AND p.resource_id IS NULL
);

INSERT INTO public.member_permissions (owner_id, member_id, section, resource_id)
SELECT DISTINCT wm.owner_id, wm.member_id, t.section, NULL::uuid
FROM public.workspace_members wm
JOIN public.member_permissions ps ON ps.owner_id = wm.owner_id AND ps.member_id = wm.member_id AND ps.section = 'shops'
CROSS JOIN (VALUES ('produtos'), ('caixa'), ('banco_lojas'), ('lojas_grupos')) AS t(section)
WHERE NOT EXISTS (
  SELECT 1 FROM public.member_permissions p
  WHERE p.owner_id = wm.owner_id AND p.member_id = wm.member_id AND p.section = t.section AND p.resource_id IS NULL
);
