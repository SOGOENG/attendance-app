-- READ ONLY catalog/aggregate inspection for the verified KazuAttendance project.
-- Never run add_driving_report_csv_export.sql on production as part of review.
begin transaction read only;

select current_database() as database_name,current_user as inspection_role,version(),
       current_setting('transaction_read_only') as read_only;

select c.relname,pg_get_userbyid(c.relowner) as owner,c.relrowsecurity,c.relforcerowsecurity,c.relacl
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relname in ('employees','driving_report_month_submissions',
 'driving_reports','driving_report_inspections','driving_alcohol_checks','driving_refuels','applications','fuel_receipts')
order by c.relname;

select table_name,column_name,data_type,udt_name,is_nullable,column_default
from information_schema.columns where table_schema='public' and table_name in
 ('employees','driving_report_month_submissions','driving_reports','driving_report_inspections',
  'driving_alcohol_checks','driving_refuels','applications','fuel_receipts')
order by table_name,ordinal_position;

select schemaname,tablename,policyname,permissive,roles,cmd,qual,with_check
from pg_policies where schemaname='public' and tablename in
 ('employees','driving_report_month_submissions','driving_reports','driving_report_inspections',
  'driving_alcohol_checks','driving_refuels','applications','fuel_receipts')
order by tablename,policyname;

select c.relname,r.rolname,has_table_privilege(r.oid,c.oid,'SELECT') as table_select,
       has_any_column_privilege(r.oid,c.oid,'SELECT') as any_column_select
from pg_class c join pg_namespace n on n.oid=c.relnamespace
cross join pg_roles r where n.nspname='public' and c.relkind in ('r','p')
and c.relname in ('employees','driving_report_month_submissions','driving_reports',
 'driving_report_inspections','driving_alcohol_checks','driving_refuels','applications','fuel_receipts')
and r.rolname in ('postgres','authenticated','anon','service_role') order by c.relname,r.rolname;

select table_name,grantee,column_name,privilege_type from information_schema.column_privileges
where table_schema='public' and table_name in ('employees','driving_report_month_submissions',
 'driving_reports','driving_report_inspections','driving_alcohol_checks','driving_refuels','applications','fuel_receipts')
and grantee in ('authenticated','anon','service_role') order by table_name,grantee,column_name,privilege_type;

select r.rolname,r.rolsuper,r.rolbypassrls from pg_roles r
where r.rolname in ('postgres','authenticated','anon','service_role');

select p.proname,pg_get_function_identity_arguments(p.oid) as arguments,
 pg_get_userbyid(p.proowner) as owner,p.prosecdef,p.provolatile,p.proconfig,p.proacl,
 pg_get_functiondef(p.oid) as definition
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in ('current_employee_id','is_application_admin',
 'can_manage_fuel_receipts','admin_driving_report_csv_source') order by p.proname;

-- No employee names, Auth UUIDs, contact details, report contents, or receipts.
-- JSON access tolerates not-yet-existing candidate setting columns.
select count(*) as employee_count,
 count(*) filter(where e.active) as active_count,
 count(*) filter(where e.active and to_jsonb(e)->>'attendance_required'='true') as attendance_required_count,
 count(*) filter(where e.active and to_jsonb(e)->>'default_vehicle_id' is not null) as default_vehicle_count,
 count(*) filter(where e.active and to_jsonb(e)->>'driving_report_required'='true') as driving_report_required_count,
 count(*) filter(where e.active and to_jsonb(e)->>'driving_required'='true') as driving_required_count
from public.employees e;

-- Locate possible dedicated roster settings without reading any setting values.
select table_name,column_name,data_type from information_schema.columns
where table_schema='public' and (column_name ~* '(driv|vehicle|attendance_required)'
 or table_name ~* '(feature|setting|permission)') order by table_name,ordinal_position;

rollback;
