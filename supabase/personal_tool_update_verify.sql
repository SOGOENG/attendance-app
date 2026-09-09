-- Read-only audit against the target DB. Existing UPDATE policies are not in the repository.
select policyname, roles, cmd, qual, with_check
from pg_policies where schemaname = 'public' and tablename = 'tools'
order by policyname;

select p.oid::regprocedure as function_name, p.prosecdef as security_definer,
  pg_get_functiondef(p.oid) as definition
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.prokind = 'f'
  and (p.proname in ('update_personal_tool', 'correct_personal_tool_identity', 'personal_tool_identity_has_history')
    or (p.prosecdef and p.prosrc ilike '%update%tools%'));

select column_name, data_type from information_schema.columns
where table_schema = 'public' and table_name = 'tools'
  and column_name in ('id', 'assigned_employee_id');

select has_function_privilege('anon',
  'public.update_personal_tool(bigint,text,text,text,text,text,text,text,text,text)', 'EXECUTE') as anon_must_be_false,
  has_function_privilege('authenticated',
  'public.update_personal_tool(bigint,text,text,text,text,text,text,text,text,text)', 'EXECUTE') as authenticated_must_be_true;

-- Review unconventional/JSON-only history references separately before deployment.
select table_schema, table_name, column_name, data_type
from information_schema.columns
where table_schema not in ('pg_catalog','information_schema')
  and (column_name ~ '(^|_)tool_id$' or column_name ~ '(^|_)management_code$'
    or ((table_name ilike '%tool%' or table_name ilike '%qr%') and data_type in ('json','jsonb')))
order by table_schema,table_name,column_name;
