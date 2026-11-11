-- Assistente (chat flutuante): a IA consulta o banco com SELECT, só leitura.
-- Transação travada em read-only (nenhum INSERT/UPDATE/DELETE passa, nem em CTE),
-- tempo máximo de 20s, até 300 linhas. Só o servidor (service_role) chama.
create or replace function public.assistant_query(q text)
returns jsonb
language plpgsql
security invoker
set statement_timeout = '20s'
as $$
declare
  r jsonb;
begin
  if q !~* '^\s*(select|with)\M' then
    raise exception 'Só consultas SELECT';
  end if;
  if q ~* '(\m(auth|vault|storage|supabase_functions|net|cron)\s*\.|pg_read|pg_ls_|pg_stat_file|\mlo_(import|export|get)|dblink|pg_sleep|set_config|pg_terminate|pg_cancel)' then
    raise exception 'Consulta não permitida';
  end if;
  set local transaction_read_only = on;
  execute format('select coalesce(jsonb_agg(t), ''[]''::jsonb) from (select * from (%s) s limit 300) t', q) into r;
  return r;
end;
$$;

revoke all on function public.assistant_query(text) from public, anon, authenticated;
grant execute on function public.assistant_query(text) to service_role;
