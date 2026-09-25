-- Permissão do sino de notificações e das subabas de Lojas e Grupos.
-- Membros que já existiam continuam vendo o que viam: o sino era de todos; as
-- subabas ficam liberadas pra quem já acessava Lojas e Grupos (ou "Lojas").

INSERT INTO public.member_permissions (owner_id, member_id, section, resource_id)
SELECT wm.owner_id, wm.member_id, 'notificacoes', NULL
FROM public.workspace_members wm
WHERE NOT EXISTS (
  SELECT 1 FROM public.member_permissions p
  WHERE p.owner_id = wm.owner_id AND p.member_id = wm.member_id AND p.section = 'notificacoes' AND p.resource_id IS NULL
);

INSERT INTO public.member_permissions (owner_id, member_id, section, resource_id)
SELECT DISTINCT wm.owner_id, wm.member_id, t.section, NULL::uuid
FROM public.workspace_members wm
JOIN public.member_permissions ps ON ps.owner_id = wm.owner_id AND ps.member_id = wm.member_id
  AND ps.section IN ('lojas_grupos', 'shops')
CROSS JOIN (VALUES ('lg_dashboard'), ('lg_diario'), ('lg_caixa'), ('lg_pedidos'), ('lg_rastreamento'), ('lg_integracoes')) AS t(section)
WHERE NOT EXISTS (
  SELECT 1 FROM public.member_permissions p
  WHERE p.owner_id = wm.owner_id AND p.member_id = wm.member_id AND p.section = t.section AND p.resource_id IS NULL
);
