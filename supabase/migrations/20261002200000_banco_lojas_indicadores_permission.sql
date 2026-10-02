-- Banco de Lojas: permissão "Indicadores das lojas" (bl_indicadores) — badges
-- dos cards (hold, pedidos/dia, payout, nota) e aba Pedidos da loja. Quem já
-- tinha a aba Banco de Lojas continua vendo tudo.
INSERT INTO public.member_permissions (owner_id, member_id, section, resource_id)
SELECT DISTINCT wm.owner_id, wm.member_id, 'bl_indicadores', NULL::uuid
FROM public.workspace_members wm
JOIN public.member_permissions pa ON pa.owner_id = wm.owner_id AND pa.member_id = wm.member_id AND pa.section = 'banco_lojas'
WHERE NOT EXISTS (
  SELECT 1 FROM public.member_permissions p
  WHERE p.owner_id = wm.owner_id AND p.member_id = wm.member_id AND p.section = 'bl_indicadores' AND p.resource_id IS NULL
);
