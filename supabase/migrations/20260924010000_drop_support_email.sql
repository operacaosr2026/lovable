-- Remove o módulo de atendimento por e-mail (caixas de suporte, conversas,
-- mensagens, fila de envio). Nunca teve tela nem uso: 0 caixas e 0 mensagens em
-- 24/09/2026 — só os 5 status padrão criados automaticamente pra cada usuário.
-- Os endpoints /api/public/hooks/mail/* já foram removidos do código.
--
-- O cadastro de usuário dispara handle_new_user_support_seed() (grava os status
-- padrão), mas o gatilho foi criado direto no banco, fora das migrations — por
-- isso ele é localizado pelo nome da função, não pelo nome do gatilho.
-- Rodar tudo de uma vez: se algum passo falhar, nada é aplicado.

-- 1) Trava: se outra função ainda usa as tabelas de suporte (ex.: uma versão
--    do handle_new_user que grava nelas), apagar as tabelas quebraria o
--    cadastro — aborta sem mudar nada.
DO $$
DECLARE deps text;
BEGIN
  SELECT string_agg(p.proname, ', ') INTO deps
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname <> 'handle_new_user_support_seed'
    AND (p.prosrc ILIKE '%support_ticket_statuses%'
         OR p.prosrc ILIKE '%handle_new_user_support_seed%'
         OR p.prosrc ILIKE '%support_inboxes%'
         OR p.prosrc ILIKE '%support_conversations%'
         OR p.prosrc ILIKE '%support_messages%'
         OR p.prosrc ILIKE '%support_customers%'
         OR p.prosrc ILIKE '%support_reply_templates%'
         OR p.prosrc ILIKE '%support_outbound_queue%');
  IF deps IS NOT NULL THEN
    RAISE EXCEPTION 'Abortado: funções ainda usam as tabelas de suporte: %', deps;
  END IF;
END $$;

-- 2) Gatilhos (em qualquer tabela, inclusive auth.users) que chamam o seed.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT t.tgname, n.nspname, c.relname
    FROM pg_trigger t
    JOIN pg_proc p       ON p.oid = t.tgfoid
    JOIN pg_class c      ON c.oid = t.tgrelid
    JOIN pg_namespace n  ON n.oid = c.relnamespace
    WHERE p.proname = 'handle_new_user_support_seed' AND NOT t.tgisinternal
  LOOP
    EXECUTE format('DROP TRIGGER %I ON %I.%I', r.tgname, r.nspname, r.relname);
  END LOOP;
END $$;

DROP FUNCTION IF EXISTS public.handle_new_user_support_seed();

-- 3) Tabelas (CASCADE leva junto policies, gatilhos de updated_at e FKs entre elas).
DROP TABLE IF EXISTS
  public.support_outbound_queue,
  public.support_messages,
  public.support_conversations,
  public.support_reply_templates,
  public.support_customers,
  public.support_ticket_statuses,
  public.support_inboxes
CASCADE;
