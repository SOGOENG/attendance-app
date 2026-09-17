-- Read-only checks; run in the Supabase SQL editor before/after applying the RPC.
select c.relname, c.relrowsecurity, c.relforcerowsecurity
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relname in ('tools','tool_history','employees','sites');

select tablename, policyname, roles, cmd, qual, with_check
from pg_policies where schemaname='public' and tablename in ('tools','tool_history')
order by tablename,policyname;

select grantee,table_name,privilege_type from information_schema.role_table_grants
where table_schema='public' and table_name in ('tools','tool_history')
order by table_name,grantee,privilege_type;

select p.oid::regprocedure as function_name, r.rolname as owner,
  p.prosecdef, p.proconfig, p.proacl, pg_get_functiondef(p.oid) as definition
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
join pg_roles r on r.oid=p.proowner
where n.nspname='public' and p.proname in ('checkout_shared_tool','return_shared_tool');

select event_object_table,trigger_name,action_timing,event_manipulation,action_statement
from information_schema.triggers
where event_object_schema='public' and event_object_table in ('tools','tool_history');

select id,active,admin_scope,auth_user_id is not null as has_auth_user
from public.employees where id=12;

select id,management_code,tool_name,ownership_type,active,checkout_managed,
  current_site_id,assigned_employee_id,status,updated_at
from public.tools where id in (295,296);
select id,tool_id,action_type,from_site_id,to_site_id,from_employee_id,
  to_employee_id,operated_by_employee_id,created_at
from public.tool_history where tool_id in (295,296) order by created_at,id;
