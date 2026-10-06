-- Cadastro fechado: conta nova só entra por convite válido.
--
-- Antes, qualquer pessoa com a chave pública (vai no JS do navegador) podia
-- chamar /auth/v1/signup e o trigger a transformava em ADMIN de um workspace
-- próprio — inclusive com um invite_token inválido/expirado, que caía no ramo
-- "Admin signup". Os convites já criam a conta pelo servidor (acceptInvitation,
-- Admin API), então isso não muda nada pra quem é convidado.
--
-- Pra criar um admin novo de propósito: Admin API com
-- app_metadata = {"allow_admin_signup": true} (só a service role consegue
-- gravar app_metadata — o navegador não).
CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_invite_token text;
  v_invite RECORD;
  v_has_invite boolean := false;
BEGIN
  v_invite_token := NEW.raw_user_meta_data->>'invite_token';

  IF v_invite_token IS NOT NULL THEN
    SELECT * INTO v_invite FROM public.member_invitations
    WHERE token = v_invite_token AND status = 'pending' AND expires_at > now()
    LIMIT 1;
    v_has_invite := FOUND;
  END IF;

  IF NOT v_has_invite AND COALESCE(NEW.raw_app_meta_data->>'allow_admin_signup', '') <> 'true' THEN
    RAISE EXCEPTION 'Cadastro fechado: só é possível criar conta por convite.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  INSERT INTO public.profiles (id, full_name, avatar_url)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)),
    NEW.raw_user_meta_data->>'avatar_url'
  );

  IF v_has_invite THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'member') ON CONFLICT (user_id) DO NOTHING;
    INSERT INTO public.workspace_members (owner_id, member_id) VALUES (v_invite.owner_id, NEW.id) ON CONFLICT DO NOTHING;
    INSERT INTO public.member_permissions (owner_id, member_id, section, resource_id)
      SELECT v_invite.owner_id, NEW.id, (p->>'section')::text, NULLIF(p->>'resource_id','')::uuid
      FROM jsonb_array_elements(v_invite.permissions) p ON CONFLICT DO NOTHING;
    UPDATE public.member_invitations SET status = 'accepted', accepted_by = NEW.id WHERE id = v_invite.id;
    RETURN NEW;
  END IF;

  -- Admin criado de propósito (allow_admin_signup)
  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'admin') ON CONFLICT (user_id) DO NOTHING;

  INSERT INTO public.stores (user_id, name, color, position) VALUES
    (NEW.id, 'Walkesty',    'oklch(0.6 0.22 285)',  0),
    (NEW.id, 'The Ravien',  'oklch(0.62 0.14 155)', 1),
    (NEW.id, 'The Kickest', 'oklch(0.7 0.14 75)',   2);

  RETURN NEW;
END;
$function$;
