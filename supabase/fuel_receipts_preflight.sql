-- READ ONLY. For the operator to inspect in staging/production BEFORE approval.
-- Codex has NOT executed this against production.
select id,name,public,file_size_limit,allowed_mime_types from storage.buckets order by id;
select policyname,permissive,roles,cmd,qual,with_check from pg_policies where schemaname='storage' and tablename='objects';
select table_name,column_name,data_type from information_schema.columns where table_schema='public' and table_name in ('driving_reports','driving_refuels','employees') order by table_name,ordinal_position;
select p.proname,r.rolname owner,p.prosecdef,p.proconfig,p.proacl from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_roles r on r.oid=p.proowner where n.nspname='public' and p.proname in ('submit_driving_report','current_employee_id','is_application_admin','fuel_receipt_command');
select admin_scope,count(*) from public.employees where active group by admin_scope;

-- Storage is intentionally service-only. These standard privileges must exist.
select rolname,rolbypassrls from pg_roles where rolname='service_role';
select has_schema_privilege('service_role','storage','USAGE') storage_usage,
 has_table_privilege('service_role','storage.objects','SELECT') object_select,
 has_table_privilege('service_role','storage.objects','INSERT') object_insert,
 has_table_privilege('service_role','storage.objects','UPDATE') object_update,
 has_table_privilege('service_role','storage.objects','DELETE') object_delete;
