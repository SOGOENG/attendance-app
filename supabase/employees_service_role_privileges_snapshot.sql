-- READ ONLY: single SELECT, catalog only. Run before/after the reviewed rollout
-- in the SAME project as postgres. Save JSON privately outside Git and compare
-- objects common to both snapshots; new rollout objects are expected additions.
-- Effective ACLs do not prove Auth, triggers, constraints or RLS business behavior.
with recursive
sr as (select * from pg_catalog.pg_roles where rolname='service_role'),
members(oid) as (
  select oid from sr union
  select a.roleid from members m join pg_catalog.pg_auth_members a on a.member=m.oid
), relations as (
  select c.* from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relname in ('employees','employee_creation_operations',
    'vehicles','driving_reports','driving_refuels','fuel_receipts','fuel_receipt_roles','applications')
), functions as (
  select p.* from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.prokind='f'
)
select jsonb_build_object(
 'reader',current_user,
 'service_role',jsonb_build_object('superuser',s.rolsuper,'bypass_rls',s.rolbypassrls,'inherit',s.rolinherit),
 'membership',coalesce((select jsonb_agg(jsonb_build_object('role',r.rolname,
   'inherited_now',pg_catalog.pg_has_role(s.oid,r.oid,'USAGE')) order by r.rolname)
   from members m join pg_catalog.pg_roles r on r.oid=m.oid),'[]'::jsonb),
 'tables',coalesce((select jsonb_agg(jsonb_build_object('table',c.relname,
   'owner',pg_catalog.pg_get_userbyid(c.relowner),'rls',c.relrowsecurity,'force_rls',c.relforcerowsecurity,
   'acl',coalesce(c.relacl,pg_catalog.acldefault('r',c.relowner)),
   'effective',(select jsonb_object_agg(p,pg_catalog.has_table_privilege(s.oid,c.oid,p))
     from unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p)) order by c.relname)
   from relations c),'[]'::jsonb),
 'employee_columns',coalesce((select jsonb_agg(jsonb_build_object('column',a.attname,'acl',a.attacl,
   'effective',(select jsonb_object_agg(p,pg_catalog.has_column_privilege(s.oid,a.attrelid,a.attnum,p))
     from unnest(array['SELECT','INSERT','UPDATE','REFERENCES']) p)) order by a.attnum)
   from pg_catalog.pg_attribute a where a.attrelid=pg_catalog.to_regclass('public.employees')
     and a.attnum>0 and not a.attisdropped),'[]'::jsonb),
 'public_sequences',coalesce((select jsonb_agg(jsonb_build_object('sequence',c.relname,
   'owner',pg_catalog.pg_get_userbyid(c.relowner),
   'effective',(select jsonb_object_agg(p,pg_catalog.has_sequence_privilege(s.oid,c.oid,p))
     from unnest(array['USAGE','SELECT','UPDATE']) p)) order by c.relname)
   from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
   where n.nspname='public' and c.relkind='S'),'[]'::jsonb),
 'functions',coalesce((select jsonb_agg(jsonb_build_object('signature',p.oid::regprocedure::text,
   'owner',pg_catalog.pg_get_userbyid(p.proowner),'security_definer',p.prosecdef,'config',p.proconfig,
   'acl',coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner)),
   'service_execute',pg_catalog.has_function_privilege(s.oid,p.oid,'EXECUTE'),
   'owner_employee_select',case when pg_catalog.to_regclass('public.employees') is not null then
     pg_catalog.has_table_privilege(p.proowner,'public.employees','SELECT') end) order by p.oid::regprocedure::text)
   from functions p),'[]'::jsonb)
) as employees_service_role_privileges_snapshot from sr s;
