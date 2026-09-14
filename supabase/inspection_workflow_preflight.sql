-- Read-only. Save results before applying inspection_initial_additions.sql.
-- Verify actual types/policies/triggers; the repository does not include the original table DDL.
select table_name,column_name,data_type,is_nullable,column_default
from information_schema.columns where table_schema='public'
and table_name in ('tools','tool_inspection_cycles','tool_inspections')
order by table_name,ordinal_position;

select p.proname,pg_get_function_identity_arguments(p.oid) as arguments,pg_get_functiondef(p.oid)
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in
 ('is_tool_registration_admin','register_admin_tool','allocate_tool_management_code','allocate_catalog_tool_management_code');

select tablename,policyname,cmd,roles,qual,with_check from pg_policies
where schemaname='public' and tablename in ('tools','tool_inspections','tool_inspection_cycles')
order by tablename,policyname;

select c.relname,t.tgname,pg_get_triggerdef(t.oid)
from pg_trigger t join pg_class c on c.oid=t.tgrelid
where not t.tgisinternal and t.tgrelid in ('public.tool_inspections'::regclass,'public.tool_inspection_cycles'::regclass);

select conrelid::regclass as relation,conname,pg_get_constraintdef(oid)
from pg_constraint where conrelid in ('public.tool_inspections'::regclass,'public.tool_inspection_cycles'::regclass);

-- Report existing duplicates; migration does not delete or consolidate any results.
select tool_id,inspection_cycle,count(*) from public.tool_inspections
group by tool_id,inspection_cycle having count(*)>1;
select cycle_code,count(*) from public.tool_inspection_cycles group by cycle_code having count(*)>1;
