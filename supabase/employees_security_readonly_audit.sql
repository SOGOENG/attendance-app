-- Production investigation only; NOT executed in production by this task.
-- Run this entire single SELECT in the intended project's SQL Editor as postgres
-- (or a reviewed role with complete SELECT access to employees, including RLS).
-- Reuse the 2026-10-22 preflight; this supplements it, not an apply approval.
-- No business RPCs, SET, locks, DDL, DML, or permission changes are executed.
-- Employee values are aggregated: no names, emails, employee IDs or Auth UUIDs.
-- Definitions/ACLs are sensitive metadata. Review trigger source for embedded
-- literals before sharing; source text cannot be guaranteed free of personal data.
-- Keep the result private and outside version control. No Edge Function source
-- (including deployed bright-service) is inspected by this SQL.
with recursive
target as (
  select c.oid,c.relowner,c.relrowsecurity,c.relforcerowsecurity,c.relacl
  from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relname='employees' and c.relkind in ('r','p')
), client_roles as (
  select oid,rolname from pg_catalog.pg_roles where rolname in ('anon','authenticated')
), membership(root_role,member_role) as (
  select oid,oid from client_roles
  union
  select m.root_role,a.roleid from membership m
  join pg_catalog.pg_auth_members a on a.member=m.member_role
), relevant_roles as (
  select r.* from pg_catalog.pg_roles r
  where r.oid in (select member_role from membership)
     or r.rolname in ('postgres','service_role',current_user)
), triggers as (
  select t.* from pg_catalog.pg_trigger t join target c on c.oid=t.tgrelid
), definers as (
  -- All public SECURITY DEFINER functions: avoids missing an unfamiliar RPC.
  -- This is an inventory, not proof of API exposure or of all transitive writes.
  select p.* from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.prokind='f' and p.prosecdef
), auth_links as (
  select count(*) link_count from public.employees
  where auth_user_id is not null group by auth_user_id
), admin_summary as (
  select count(*) total,
    count(*) filter(where active is true) active,
    count(*) filter(where active is not true) inactive_or_unknown,
    count(*) filter(where auth_user_id is not null) auth_linked,
    count(*) filter(where auth_user_id is null) auth_unlinked,
    count(*) filter(where active is true and auth_user_id is not null) active_and_linked,
    count(*) filter(where exists(select 1 from public.employees other
      where other.auth_user_id=e.auth_user_id and other.id<>e.id)) shared_auth_link
  from public.employees e where admin_scope='all'
)
select jsonb_build_object(
  'scope','Supplement to existing preflight; metadata plus aggregate employee checks only. No production change.',
  'reader',jsonb_build_object('role',current_user,
    'superuser',r.rolsuper,'bypass_rls',r.rolbypassrls,
    'employees_owner',pg_catalog.pg_get_userbyid(c.relowner),
    'rls',c.relrowsecurity,'force_rls',c.relforcerowsecurity,
    'complete_read_required','Counts require full visibility; successful SELECT alone is not proof.'),
  'employee_triggers',coalesce((select jsonb_agg(jsonb_build_object(
    'name',t.tgname,'internal',t.tgisinternal,'enabled',t.tgenabled,
    'definition',pg_catalog.pg_get_triggerdef(t.oid),
    'function',t.tgfoid::regprocedure::text,
    'function_owner',pg_catalog.pg_get_userbyid(p.proowner),
    'security_definer',p.prosecdef,'config',p.proconfig,
    'function_definition',pg_catalog.pg_get_functiondef(p.oid)) order by t.tgname)
    from triggers t join pg_catalog.pg_proc p on p.oid=t.tgfoid),'[]'::jsonb),
  'client_effective_table_privileges',coalesce((select jsonb_agg(jsonb_build_object(
    'role',s.rolname,
    'insert',pg_catalog.has_table_privilege(s.oid,c.oid,'INSERT'),
    'update',pg_catalog.has_table_privilege(s.oid,c.oid,'UPDATE'),
    'delete',pg_catalog.has_table_privilege(s.oid,c.oid,'DELETE'),
    'truncate',pg_catalog.has_table_privilege(s.oid,c.oid,'TRUNCATE'),
    'any_column_insert',pg_catalog.has_any_column_privilege(s.oid,c.oid,'INSERT'),
    'any_column_update',pg_catalog.has_any_column_privilege(s.oid,c.oid,'UPDATE')) order by s.rolname)
    from client_roles s),'[]'::jsonb),
  'table_acl_sources',coalesce((select jsonb_agg(jsonb_build_object(
    'grantor',pg_catalog.pg_get_userbyid(a.grantor),
    'grantee',case when a.grantee=0 then 'PUBLIC' else pg_catalog.pg_get_userbyid(a.grantee) end,
    'privilege',a.privilege_type,'grantable',a.is_grantable) order by a.grantee,a.privilege_type)
    from pg_catalog.aclexplode(coalesce(c.relacl,pg_catalog.acldefault('r',c.relowner))) a),'[]'::jsonb),
  'column_grants',coalesce((select jsonb_agg(jsonb_build_object(
    'column',a.attname,'grantor',pg_catalog.pg_get_userbyid(x.grantor),
    'grantee',case when x.grantee=0 then 'PUBLIC' else pg_catalog.pg_get_userbyid(x.grantee) end,
    'privilege',x.privilege_type,'grantable',x.is_grantable) order by a.attnum,x.grantee,x.privilege_type)
    from pg_catalog.pg_attribute a cross join lateral pg_catalog.aclexplode(a.attacl) x
    where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped),'[]'::jsonb),
  'client_effective_column_writes',coalesce((select jsonb_agg(jsonb_build_object(
    'role',s.rolname,'column',a.attname,
    'insert',pg_catalog.has_column_privilege(s.oid,c.oid,a.attnum,'INSERT'),
    'update',pg_catalog.has_column_privilege(s.oid,c.oid,a.attnum,'UPDATE')) order by s.rolname,a.attnum)
    from pg_catalog.pg_attribute a cross join client_roles s
    where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped),'[]'::jsonb),
  'reachable_role_memberships',coalesce((select jsonb_agg(jsonb_build_object(
    'client',s.rolname,'reachable_role',p.rolname,
    'inherited_now',pg_catalog.pg_has_role(s.oid,p.oid,'USAGE'),
    'note','Membership reachability is not permission to SET ROLE through the HTTP API.') order by s.rolname,p.rolname)
    from membership m join client_roles s on s.oid=m.root_role
    join pg_catalog.pg_roles p on p.oid=m.member_role),'[]'::jsonb),
  'membership_edges',coalesce((select jsonb_agg(jsonb_build_object(
    'member',pg_catalog.pg_get_userbyid(a.member),'role',pg_catalog.pg_get_userbyid(a.roleid),
    'admin_option',a.admin_option) order by a.member,a.roleid)
    from pg_catalog.pg_auth_members a where a.member in(select member_role from membership)),'[]'::jsonb),
  'role_attributes',coalesce((select jsonb_agg(jsonb_build_object(
    'role',rolname,'superuser',rolsuper,'bypass_rls',rolbypassrls,
    'inherit',rolinherit,'create_role',rolcreaterole,'login',rolcanlogin) order by rolname)
    from relevant_roles),'[]'::jsonb),
  'public_security_definer_inventory',coalesce((select jsonb_agg(jsonb_build_object(
    'signature',p.oid::regprocedure::text,'owner',pg_catalog.pg_get_userbyid(p.proowner),
    'config',p.proconfig,'acl',coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner)),
    'anon_execute',pg_catalog.has_function_privilege('anon',p.oid,'EXECUTE'),
    'authenticated_execute',pg_catalog.has_function_privilege('authenticated',p.oid,'EXECUTE'),
    'service_role_execute',pg_catalog.has_function_privilege('service_role',p.oid,'EXECUTE')) order by p.oid::regprocedure::text)
    from definers p),'[]'::jsonb),
  'auth_link_duplicates',jsonb_build_object(
    'duplicate_groups',(select count(*) from auth_links where link_count>1),
    'rows_in_duplicate_groups',(select coalesce(sum(link_count),0) from auth_links where link_count>1),
    'excess_rows',(select coalesce(sum(link_count-1),0) from auth_links where link_count>1)),
  'all_admin_aggregate',(select to_jsonb(s) from admin_summary s),
  'limitations',jsonb_build_array(
    'Auth linkage means non-null employees.auth_user_id; Auth account existence, disabled state and login success are not verified.',
    'Admin counts describe all admin_scope=all rows; no named individual is identified.',
    'Effective grants do not prove an operation succeeds: triggers, constraints and RLS must be reviewed separately.',
    'Trigger definitions do not include the bodies of functions they call; review those dependencies separately.',
    'Public definer inventory includes trigger/internal functions; HTTP exposure and other-schema call chains require separate review.')
)
as employees_security_readonly_audit
from target c join pg_catalog.pg_roles r on r.rolname=current_user;
