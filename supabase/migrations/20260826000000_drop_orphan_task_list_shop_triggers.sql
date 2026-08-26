-- O módulo Pessoal (Hábitos, Tarefas, Calendário) foi removido em
-- 20260818120000_drop_personal_tasks_habits_calendar.sql (DROP TABLE task_lists CASCADE),
-- mas os triggers em public.shops que inseriam/atualizavam task_lists ficaram órfãos
-- (CASCADE não os apagou, pois estavam em outra tabela). Toda criação ou renomeação
-- de loja passou a falhar com "relation public.task_lists does not exist".

DROP TRIGGER IF EXISTS shops_create_task_list ON public.shops;
DROP TRIGGER IF EXISTS shops_sync_task_list_name ON public.shops;

DROP FUNCTION IF EXISTS public.handle_new_shop_create_list();
DROP FUNCTION IF EXISTS public.handle_shop_name_sync();
