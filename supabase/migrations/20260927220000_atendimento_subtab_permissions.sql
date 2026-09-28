-- Subabas de Atendimento (Caixa, KPI, Configurações). Quem já tinha a aba
-- Atendimento continua vendo tudo.
INSERT INTO public.member_permissions (owner_id, member_id, section, resource_id)
SELECT DISTINCT wm.owner_id, wm.member_id, t.section, NULL::uuid
FROM public.workspace_members wm
JOIN public.member_permissions pa ON pa.owner_id = wm.owner_id AND pa.member_id = wm.member_id AND pa.section = 'atendimento'
CROSS JOIN (VALUES ('at_caixa'), ('at_kpi'), ('at_config')) AS t(section)
WHERE NOT EXISTS (
  SELECT 1 FROM public.member_permissions p
  WHERE p.owner_id = wm.owner_id AND p.member_id = wm.member_id AND p.section = t.section AND p.resource_id IS NULL
);
