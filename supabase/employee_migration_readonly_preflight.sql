-- Investigation only: ONE SELECT. No SET, DDL/DML, locks, dynamic SQL or business RPC calls.
-- Run the whole file in the intended project's SQL Editor as postgres/full catalog reader.
-- Returns ONE row / ONE JSON cell. Missing optional migration objects are normal.
-- Requires existing public.employees(id,auth_user_id,active,admin_scope) and auth.users(id,email).
-- No employee names, email values, IDs, Auth UUIDs, passwords, tokens or app_metadata returned.
-- Function/view/policy/default source may contain embedded sensitive literals: review before sharing.
with recursive
wanted_tables(schema_name,table_name) as (values
 ('public','employees'),('public','employee_creation_operations'),
 ('public','employee_registration_settings'),('public','vehicles'),('public','fuel_receipt_roles')),
relations as (
 select c.*,n.nspname from pg_catalog.pg_class c
 join pg_catalog.pg_namespace n on n.oid=c.relnamespace
 join wanted_tables w on w.schema_name=n.nspname and w.table_name=c.relname
), roles as (
 select * from pg_catalog.pg_roles where rolname in ('anon','authenticated','service_role')
), memberships(root_role,member_role) as (
 select oid,oid from roles
 union
 select m.root_role,a.roleid from memberships m
 join pg_catalog.pg_auth_members a on a.member=m.member_role
), expected_rpc(name) as (values
 ('employee_edit_context'),('employee_edit_internal'),('admin_edit_employee'),('department_edit_employee'),
 ('begin_employee_creation'),('finish_employee_creation'),('employee_creation_status'),
 ('employee_registration_ready'),('employee_registration_actor'),('employee_registration_completed'),
 ('begin_employee_registration'),('advance_employee_registration'),('recover_employee_registration'),
 ('guard_employee_registration'),('admin_get_vehicle_master'),('admin_save_vehicle_master'),
 ('admin_set_employee_managed_vehicle'),('set_my_default_vehicle'),('current_employee_id'),('is_application_admin')),
functions as (
 select p.*,n.nspname from pg_catalog.pg_proc p
 join pg_catalog.pg_namespace n on n.oid=p.pronamespace
 where p.prokind='f' and (
   (n.nspname='public' and (p.prosecdef or p.proname in(select name from expected_rpc)
      or p.proname like '%employee%' or p.proname like '%registration%'))
   or p.oid in(select tgfoid from pg_catalog.pg_trigger where tgrelid in(select oid from relations)))
), employees as (
 select e.id,e.auth_user_id,e.active,e.admin_scope from public.employees e
), auth_links as (
 select auth_user_id,count(*) n from employees where auth_user_id is not null group by auth_user_id
), reader as (
 select r.rolsuper,r.rolbypassrls,c.relrowsecurity,c.relforcerowsecurity,
   (not c.relrowsecurity or r.rolsuper or r.rolbypassrls
     or (c.relowner=r.oid and not c.relforcerowsecurity)) as employees_visibility_proven,
   (not a.relrowsecurity or r.rolsuper or r.rolbypassrls
     or (a.relowner=r.oid and not a.relforcerowsecurity)) as auth_visibility_proven
 from pg_catalog.pg_roles r cross join pg_catalog.pg_class c cross join pg_catalog.pg_class a
 where r.rolname=current_user and c.oid='public.employees'::regclass and a.oid='auth.users'::regclass
)
select jsonb_build_object(
 'audit_version','employee-migration-v1',
 'captured_at',pg_catalog.statement_timestamp(),
 'runtime',jsonb_build_object('database',current_database(),'reader',current_user,
   'server_version',pg_catalog.current_setting('server_version'),
   'visibility',(select to_jsonb(r) from reader r)),
 'required_roles',(select jsonb_agg(jsonb_build_object('name',v.name,'exists',r.oid is not null) order by v.name)
   from (values('anon'),('authenticated'),('service_role')) v(name) left join roles r on r.rolname=v.name),
 'tables',(select jsonb_agg(jsonb_build_object('schema',w.schema_name,'name',w.table_name,
   'exists',c.oid is not null,'kind',c.relkind,'owner',pg_catalog.pg_get_userbyid(c.relowner),
   'rls',c.relrowsecurity,'force_rls',c.relforcerowsecurity) order by w.table_name)
   from wanted_tables w left join relations c on c.nspname=w.schema_name and c.relname=w.table_name),
 'columns',(select coalesce(jsonb_agg(jsonb_build_object('table',c.relname,'column',a.attname,
   'type',pg_catalog.format_type(a.atttypid,a.atttypmod),'not_null',a.attnotnull,
   'identity',a.attidentity,'generated',a.attgenerated,
   'default',pg_catalog.pg_get_expr(d.adbin,d.adrelid)) order by c.relname,a.attnum),'[]'::jsonb)
   from relations c join pg_catalog.pg_attribute a on a.attrelid=c.oid and a.attnum>0 and not a.attisdropped
   left join pg_catalog.pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum),
 'constraints',(select coalesce(jsonb_agg(jsonb_build_object('table',k.conrelid::regclass::text,
   'name',k.conname,'type',k.contype,'validated',k.convalidated,
   'definition',pg_catalog.pg_get_constraintdef(k.oid)) order by k.conrelid,k.conname),'[]'::jsonb)
   from pg_catalog.pg_constraint k where k.conrelid in(select oid from relations)
   or k.confrelid='public.employees'::regclass),
 'indexes',(select coalesce(jsonb_agg(jsonb_build_object('table',i.indrelid::regclass::text,
   'valid',i.indisvalid,'ready',i.indisready,'definition',pg_catalog.pg_get_indexdef(i.indexrelid))
   order by i.indexrelid),'[]'::jsonb) from pg_catalog.pg_index i where i.indrelid in(select oid from relations)),
 'triggers',(select coalesce(jsonb_agg(jsonb_build_object('table',t.tgrelid::regclass::text,
   'name',t.tgname,'internal',t.tgisinternal,'enabled',t.tgenabled,
   'definition',pg_catalog.pg_get_triggerdef(t.oid),'function',t.tgfoid::regprocedure::text)
   order by t.tgrelid,t.tgname),'[]'::jsonb) from pg_catalog.pg_trigger t where t.tgrelid in(select oid from relations)),
 'policies',(select coalesce(jsonb_agg(to_jsonb(p) order by p.tablename,p.policyname),'[]'::jsonb)
   from pg_catalog.pg_policies p join wanted_tables w on w.schema_name=p.schemaname and w.table_name=p.tablename),
 'effective_privileges',(select coalesce(jsonb_agg(jsonb_build_object('role',r.rolname,'table',c.relname,
   'schema_usage',pg_catalog.has_schema_privilege(r.oid,c.relnamespace,'USAGE'),
   'select',pg_catalog.has_table_privilege(r.oid,c.oid,'SELECT'),
   'any_column_select',pg_catalog.has_any_column_privilege(r.oid,c.oid,'SELECT'),
   'insert',pg_catalog.has_table_privilege(r.oid,c.oid,'INSERT'),
   'update',pg_catalog.has_table_privilege(r.oid,c.oid,'UPDATE'),
   'delete',pg_catalog.has_table_privilege(r.oid,c.oid,'DELETE'),
   'truncate',pg_catalog.has_table_privilege(r.oid,c.oid,'TRUNCATE'),
   'references',pg_catalog.has_table_privilege(r.oid,c.oid,'REFERENCES'),
   'trigger',pg_catalog.has_table_privilege(r.oid,c.oid,'TRIGGER'),
   'any_column_insert',pg_catalog.has_any_column_privilege(r.oid,c.oid,'INSERT'),
   'any_column_update',pg_catalog.has_any_column_privilege(r.oid,c.oid,'UPDATE'))
   order by c.relname,r.rolname),'[]'::jsonb) from relations c cross join roles r where c.relkind in ('r','p')),
 'employee_column_access',(select coalesce(jsonb_agg(jsonb_build_object('role',r.rolname,'column',a.attname,
   'select',pg_catalog.has_column_privilege(r.oid,c.oid,a.attnum,'SELECT'),
   'insert',pg_catalog.has_column_privilege(r.oid,c.oid,a.attnum,'INSERT'),
   'update',pg_catalog.has_column_privilege(r.oid,c.oid,a.attnum,'UPDATE')) order by r.rolname,a.attnum),'[]'::jsonb)
   from relations c join pg_catalog.pg_attribute a on a.attrelid=c.oid and a.attnum>0 and not a.attisdropped
   cross join roles r where c.relname='employees'),
 'table_acl_sources',(select coalesce(jsonb_agg(jsonb_build_object('table',c.relname,
   'grantee',case when x.grantee=0 then 'PUBLIC' else pg_catalog.pg_get_userbyid(x.grantee) end,
   'grantor',pg_catalog.pg_get_userbyid(x.grantor),'privilege',x.privilege_type,'grantable',x.is_grantable)
   order by c.relname,x.grantee,x.privilege_type),'[]'::jsonb)
   from relations c cross join lateral pg_catalog.aclexplode(coalesce(c.relacl,pg_catalog.acldefault('r',c.relowner))) x),
 'column_acl_sources',(select coalesce(jsonb_agg(jsonb_build_object('table',c.relname,'column',a.attname,
   'grantee',case when x.grantee=0 then 'PUBLIC' else pg_catalog.pg_get_userbyid(x.grantee) end,
   'privilege',x.privilege_type,'grantable',x.is_grantable) order by c.relname,a.attnum,x.grantee,x.privilege_type),'[]'::jsonb)
   from relations c join pg_catalog.pg_attribute a on a.attrelid=c.oid and a.attnum>0 and not a.attisdropped
   cross join lateral pg_catalog.aclexplode(a.attacl) x),
 'role_memberships',(select coalesce(jsonb_agg(jsonb_build_object('root',r.rolname,'reachable_role',p.rolname,
   'inherits_now',pg_catalog.pg_has_role(r.oid,p.oid,'USAGE'),'superuser',p.rolsuper,
   'bypass_rls',p.rolbypassrls,'inherit',p.rolinherit) order by r.rolname,p.rolname),'[]'::jsonb)
   from memberships m join roles r on r.oid=m.root_role join pg_catalog.pg_roles p on p.oid=m.member_role),
 'default_privileges',(select coalesce(jsonb_agg(jsonb_build_object('owner',pg_catalog.pg_get_userbyid(d.defaclrole),
   'schema',n.nspname,'object_type',d.defaclobjtype,'acl',d.defaclacl) order by d.oid),'[]'::jsonb)
   from pg_catalog.pg_default_acl d left join pg_catalog.pg_namespace n on n.oid=d.defaclnamespace
   where d.defaclnamespace=0 or n.nspname='public'),
 'expected_rpc_names',(select jsonb_agg(jsonb_build_object('name',e.name,
   'overload_count',(select count(*) from functions f where f.nspname='public' and f.proname=e.name)) order by e.name) from expected_rpc e),
 'functions',(select coalesce(jsonb_agg(jsonb_build_object('signature',f.oid::regprocedure::text,
   'owner',pg_catalog.pg_get_userbyid(f.proowner),'security_definer',f.prosecdef,'volatility',f.provolatile,
   'config',f.proconfig,'source_md5',pg_catalog.md5(f.prosrc),'definition',pg_catalog.pg_get_functiondef(f.oid),
   'acl',coalesce(f.proacl,pg_catalog.acldefault('f',f.proowner)),
   'execute',(select jsonb_object_agg(r.rolname,pg_catalog.has_function_privilege(r.oid,f.oid,'EXECUTE')) from roles r))
   order by f.oid::regprocedure::text),'[]'::jsonb) from functions f),
 'public_views',(select coalesce(jsonb_agg(jsonb_build_object('name',c.relname,'kind',c.relkind,
   'owner',pg_catalog.pg_get_userbyid(c.relowner),'options',c.reloptions,
   'definition',pg_catalog.pg_get_viewdef(c.oid,true),
   'access',(select jsonb_object_agg(r.rolname,jsonb_build_object(
     'schema_usage',pg_catalog.has_schema_privilege(r.oid,c.relnamespace,'USAGE'),
     'select',pg_catalog.has_table_privilege(r.oid,c.oid,'SELECT'),
     'any_column_select',pg_catalog.has_any_column_privilege(r.oid,c.oid,'SELECT'))) from roles r))
   order by c.relname),'[]'::jsonb) from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
   where n.nspname='public' and c.relkind in ('v','m')),
 'employee_auth_aggregate',jsonb_build_object(
   'employee_count',(select count(*) from employees),
   'unlinked',(select count(*) from employees where auth_user_id is null),
   'linked_auth_missing',(select count(*) from employees e where e.auth_user_id is not null
     and not exists(select 1 from auth.users u where u.id=e.auth_user_id)),
   'duplicate_auth_groups',(select count(*) from auth_links where n>1),
   'employees_in_duplicate_groups',(select coalesce(sum(n),0) from auth_links where n>1),
   'active_all_admins',(select count(*) from employees where active is true and admin_scope='all'),
   'active_all_admins_with_unique_existing_auth',(select count(*) from employees e join auth_links l on l.auth_user_id=e.auth_user_id and l.n=1
     where e.active is true and e.admin_scope='all' and exists(select 1 from auth.users u where u.id=e.auth_user_id)),
   'internal_email_link_mismatch',(select count(*) from employees e join auth.users u on u.id=e.auth_user_id
     where u.email is distinct from 'employee-'||e.id::text||'@staff-portal.local'),
   'unlinked_portal_auth_accounts',(select count(*) from auth.users u where u.email ~ '^employee-[0-9]+@staff-portal[.]local$'
     and not exists(select 1 from employees e where e.auth_user_id=u.id))),
 'anonymous_read_assessment',(select jsonb_build_object(
   'rls_enabled',c.relrowsecurity,'force_rls',c.relforcerowsecurity,
   'direct_table_read_unrestricted_by_rls',pg_catalog.has_schema_privilege(r.oid,c.relnamespace,'USAGE')
     and (pg_catalog.has_table_privilege(r.oid,c.oid,'SELECT') or pg_catalog.has_any_column_privilege(r.oid,c.oid,'SELECT'))
     and (not c.relrowsecurity or r.rolsuper or r.rolbypassrls or (r.oid=c.relowner and not c.relforcerowsecurity)),
   'http_exposure','Not tested. Check exposed schemas, gateway configuration, views and RPC call chains separately.')
   from relations c cross join roles r where c.relname='employees' and r.rolname='anon'),
 'limitations',jsonb_build_array(
   'Aggregate counts are authoritative only with full employees AND auth.users visibility; no login capability is proved.',
   'Optional registration tables are inventoried via catalogs only; their row contents, pending state counts and enabled flag are NOT read.',
   'Missing optional tables do not cause failure. Missing baseline employees/auth.users or insufficient read permission causes failure; do not grant privileges just to run this audit.',
   'No deployed Edge source/secrets/config, backup/PITR state, real Auth isolation or HTTP data access is tested.',
   'Public views and SECURITY DEFINER inventory require manual source review; dynamic SQL, transitive calls and exposed non-public schemas may need additional investigation.',
   'No automatic production approval. No sequences are advanced and no business functions are invoked.')
) as employee_migration_preflight;
