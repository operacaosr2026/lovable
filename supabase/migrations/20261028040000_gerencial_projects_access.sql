-- Projetos virou subaba do Gerencial: quem tem a permissão Gerencial vê e edita
-- todos os projetos (e tarefas, notas e anexos deles, que usam a mesma checagem).
-- A permissão por projeto (section 'projects' com resource_id) continua valendo.
CREATE OR REPLACE FUNCTION public.has_workspace_access(_member uuid, _owner uuid, _section text, _resource uuid DEFAULT NULL::uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    EXISTS (
      SELECT 1 FROM public.workspace_members wm
      WHERE wm.owner_id = _owner AND wm.member_id = _member AND wm.is_admin
    )
    OR (
      EXISTS (
        SELECT 1 FROM public.workspace_members wm
        WHERE wm.owner_id = _owner AND wm.member_id = _member
      )
      AND EXISTS (
        SELECT 1 FROM public.member_permissions p
        WHERE p.owner_id = _owner
          AND p.member_id = _member
          AND (
            (p.section = _section AND (p.resource_id IS NULL OR _resource IS NULL OR p.resource_id = _resource))
            OR (_section = 'projects' AND p.section = 'gerencial')
          )
      )
    )
$function$;
