-- READ ONLY: one catalog SELECT. Run as reviewed owner in intended project.
-- No business data/function calls. Save before/after JSON privately.
-- Review ALL SELECT/ALL policies, inherited grants, and existing employee
-- SELECT/auth schema privileges. This is evidence, not automatic apply approval.
with targets as (
 select c.* from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
 where n.nspname='public' and c.relname in ('tool_catalog','employees')
), roles as (
 select * from pg_catalog.pg_roles where rolname in ('anon','authenticated','service_role',current_user)
)
select jsonb_build_object(
 'reader',current_user,
 'tables',coalesce((select jsonb_agg(jsonb_build_object('table',c.relname,
   'owner',pg_catalog.pg_get_userbyid(c.relowner),'rls',c.relrowsecurity,'force_rls',c.relforcerowsecurity,
   'acl',coalesce(c.relacl,pg_catalog.acldefault('r',c.relowner))) order by c.relname) from targets c),'[]'::jsonb),
 'policies',coalesce((select jsonb_agg(to_jsonb(p) order by p.tablename,p.policyname)
   from pg_catalog.pg_policies p where p.schemaname='public' and p.tablename in ('tool_catalog','employees')),'[]'::jsonb),
 'effective_reads',coalesce((select jsonb_agg(jsonb_build_object('table',c.relname,'role',r.rolname,
   'table_select',pg_catalog.has_table_privilege(r.oid,c.oid,'SELECT'),
   'any_column_select',pg_catalog.has_any_column_privilege(r.oid,c.oid,'SELECT'),
   'bypass_rls',r.rolbypassrls,'superuser',r.rolsuper) order by c.relname,r.rolname)
   from targets c cross join roles r),'[]'::jsonb),
 'column_reads',coalesce((select jsonb_agg(jsonb_build_object('table',c.relname,'column',a.attname,
   'role',r.rolname,'select',pg_catalog.has_column_privilege(r.oid,c.oid,a.attnum,'SELECT'),'acl',a.attacl)
   order by c.relname,a.attnum,r.rolname) from targets c
   join pg_catalog.pg_attribute a on a.attrelid=c.oid and a.attnum>0 and not a.attisdropped cross join roles r),'[]'::jsonb),
 'auth_schema_usage',coalesce((select jsonb_agg(jsonb_build_object('role',r.rolname,
   'usage',pg_catalog.has_schema_privilege(r.oid,'auth','USAGE')) order by r.rolname) from roles r),'[]'::jsonb),
 'membership',coalesce((select jsonb_agg(jsonb_build_object('role',r.rolname,'reachable_role',parent.rolname,
   'inherited_now',pg_catalog.pg_has_role(r.oid,parent.oid,'USAGE')) order by r.rolname,parent.rolname)
   from roles r cross join pg_catalog.pg_roles parent
   where pg_catalog.pg_has_role(r.oid,parent.oid,'MEMBER')),'[]'::jsonb),
 'catalog_rpcs',coalesce((select jsonb_agg(jsonb_build_object('signature',p.oid::regprocedure::text,
   'owner',pg_catalog.pg_get_userbyid(p.proowner),'acl',p.proacl,'definition',pg_catalog.pg_get_functiondef(p.oid)) order by p.oid)
   from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.prokind='f' and p.proname in ('personal_tool_catalog','is_tool_registration_admin')),'[]'::jsonb)
) as tool_catalog_read_security_preflight;
