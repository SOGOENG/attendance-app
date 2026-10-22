-- SELECT only: no business functions, Auth records or employee rows are read.
with targets(signature) as (
 values ('public.cancel_application(bigint,text)'),
 ('public.reopen_application_draft(bigint)'),
 ('public.recalculate_paid_leave_balance(bigint)')
), history as (
 select c.oid from pg_catalog.pg_class c
 join pg_catalog.pg_namespace n on n.oid=c.relnamespace
 where n.nspname='public' and c.relname='application_status_history'
)
select jsonb_build_object(
 'audit','application_rpc_authorization_preflight_v1',
 'checked_at',statement_timestamp(),'current_user',current_user,
 'functions',(select jsonb_agg(jsonb_build_object(
  'signature',t.signature,'exists',p.oid is not null,
  'owner',pg_catalog.pg_get_userbyid(p.proowner),
  'security_definer',p.prosecdef,'config',p.proconfig,
  'body_md5',md5(p.prosrc),'lf_body_md5',md5(replace(p.prosrc,E'\r\n',E'\n')),
  'arguments',pg_catalog.pg_get_function_arguments(p.oid),
  'definition',pg_catalog.pg_get_functiondef(p.oid),
  'acl',(select jsonb_agg(jsonb_build_object(
   'grantee',case when a.grantee=0 then 'PUBLIC' else pg_catalog.pg_get_userbyid(a.grantee) end,
   'grantor',pg_catalog.pg_get_userbyid(a.grantor),
   'privilege',a.privilege_type,'grantable',a.is_grantable
  ) order by a.grantee) from pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) a),
  'effective_execute',(select jsonb_object_agg(r.rolname,pg_catalog.has_function_privilege(r.oid,p.oid,'EXECUTE'))
   from pg_catalog.pg_roles r where r.rolname in ('anon','authenticated','service_role'))
 ) order by t.signature) from targets t left join pg_catalog.pg_proc p on p.oid=pg_catalog.to_regprocedure(t.signature)),
 'history_table_exists',exists(select 1 from history),
 'history_actor_column',(select jsonb_build_object(
  'exists',true,'type',pg_catalog.format_type(a.atttypid,a.atttypmod),'not_null',a.attnotnull
 ) from pg_catalog.pg_attribute a where a.attrelid in (select oid from history)
   and a.attname='changed_by_employee_id' and a.attnum>0 and not a.attisdropped),
 'history_constraints',(select jsonb_agg(jsonb_build_object(
  'name',k.conname,'definition',pg_catalog.pg_get_constraintdef(k.oid),'validated',k.convalidated
 ) order by k.conname) from pg_catalog.pg_constraint k where k.conrelid in (select oid from history)),
 'history_triggers',(select jsonb_agg(jsonb_build_object(
  'name',t.tgname,'enabled',t.tgenabled,'definition',pg_catalog.pg_get_triggerdef(t.oid)
 ) order by t.tgname) from pg_catalog.pg_trigger t where t.tgrelid in (select oid from history) and not t.tgisinternal)
) as application_rpc_authorization_preflight;
