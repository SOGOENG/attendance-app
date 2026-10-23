-- LOCAL PREPARATION ONLY. Shared production DB: see employee_safe_registration_rollout.md.
-- Apply once AFTER add_employee_management_rpc.sql and add_employee_creation_operations.sql.
-- Existing employees, Auth accounts, RLS and client grants are not rewritten here.
begin;
do $$
declare r record;
begin
 for r in select * from (values
  ('employee_edit_context()',array['613d91d29704458b5d55a0a1c56d4292','4bccc43ffef0779fc417b2c4488943f3']),
  ('begin_employee_creation(uuid,uuid,jsonb)',array['a44e5e611f26577993325d0051ee9bbb','2afbb3cd341e3b4c6ee52aafd7390657']),
  ('finish_employee_creation(uuid,uuid,uuid,text)',array['ab0931a51560933c1e93c423f6616b16','2e57bbf3fabd43f3a910a752d55260b3'])
 ) v(signature,hashes) loop
  if not exists(select 1 from pg_catalog.pg_proc p where p.oid=pg_catalog.to_regprocedure('public.'||r.signature)
   and p.proowner=(select oid from pg_catalog.pg_roles where rolname=current_user) and md5(p.prosrc)=any(r.hashes))
  then raise exception 'employee_registration_definition_requires_review: %',r.signature; end if;
 end loop;
 if pg_catalog.to_regclass('auth.users') is null then raise exception 'auth_users_required'; end if;
 if exists(select 1 from public.employee_creation_operations where state<>'completed')
 then raise exception 'legacy_pending_operations_require_review'; end if;
end;
$$;
alter table public.employee_creation_operations add column protocol integer not null default 1,
 add column worker_token uuid, add column auth_id uuid, add column last_actor uuid;
alter table public.employee_creation_operations drop constraint employee_creation_operations_state_check;
alter table public.employee_creation_operations add constraint employee_creation_operations_state_check
 check(state in ('employee_created','completed','recovery_required','auth_creating','auth_bound','releasing'));
create table public.employee_registration_settings(singleton boolean primary key default true check(singleton), enabled boolean not null default false,
 reviewed_main_revision text,activated_at timestamptz);
insert into public.employee_registration_settings(singleton,enabled) values(true,false);
alter table public.employee_registration_settings enable row level security;
revoke all on public.employee_registration_settings from public,anon,authenticated,service_role;

create function public.employee_registration_ready() returns boolean
language sql stable security definer set search_path='' as $$
 select not pg_catalog.has_any_column_privilege('anon','public.employees','SELECT')
  and not exists(select 1 from unnest(array['anon','authenticated']) r
  where pg_catalog.has_table_privilege(r,'public.employees','INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
   or pg_catalog.has_any_column_privilege(r,'public.employees','INSERT,UPDATE,REFERENCES')
   or (current_setting('server_version_num')::integer>=170000 and pg_catalog.has_table_privilege(r,'public.employees','MAINTAIN')));
$$;

-- No actor ID supplied by the browser is trusted. Edge derives this UUID from getUser().
create function public.employee_registration_actor(p_actor uuid) returns void
language plpgsql security definer set search_path='' set row_security=off as $$
declare n integer; a public.employees;
begin
 select count(*) into n from public.employees where auth_user_id=p_actor;
 select * into a from public.employees where auth_user_id=p_actor and active for update;
 if p_actor is null or n<>1 or a.id is null or a.admin_scope is distinct from 'all'
 or exists(select 1 from public.employee_creation_operations o where o.employee_id=a.id and o.state<>'completed')
 then raise exception 'employee_admin_required' using errcode='42501'; end if;
end; $$;

create function public.employee_registration_completed(p_operation uuid) returns jsonb
language plpgsql stable security definer set search_path='' set row_security=off as $$
declare o public.employee_creation_operations;
begin
 select * into o from public.employee_creation_operations where operation_id=p_operation and protocol=2 and state='completed';
 if not found or not exists(select 1 from public.employees e join auth.users u on u.id=e.auth_user_id
  where e.id=o.employee_id and u.id=o.auth_id and u.email='employee-'||o.employee_id||'@staff-portal.local'
   and u.raw_app_meta_data->>'employee_creation_operation'=o.operation_id::text)
 then raise exception 'registration_completion_inconsistent'; end if;
 return jsonb_build_object('state','completed','employeeId',o.employee_id,'operationId',o.operation_id);
end; $$;

-- Preserve registration order, input validation and conservative duplicate suppression.
create function public.begin_employee_registration(p_actor uuid,p_operation uuid,p_data jsonb,p_worker uuid) returns jsonb
language plpgsql security definer set search_path='' set row_security=off as $$
declare result jsonb; o public.employee_creation_operations;
begin
 perform pg_catalog.pg_advisory_xact_lock(726314923);
 perform public.employee_registration_actor(p_actor);
 if not (select enabled from public.employee_registration_settings where singleton) or not public.employee_registration_ready()
 then raise exception 'employee_creation_paused'; end if;
 if p_worker is null then raise exception 'worker_required'; end if;
 result:=public.begin_employee_creation(p_actor,p_operation,p_data);
 select * into o from public.employee_creation_operations where operation_id=(result->>'operationId')::uuid for update;
 if (result->>'process')::boolean then
  update public.employee_creation_operations set protocol=2,state='auth_creating',worker_token=p_worker,last_actor=p_actor where operation_id=o.operation_id;
 elsif o.protocol<>2 then raise exception 'legacy_operation_requires_review';
 elsif o.state='completed' then perform public.employee_registration_completed(o.operation_id); end if;
 return result || jsonb_build_object('protocol',2,'state',case when (result->>'process')::boolean then 'auth_creating' else o.state end);
end; $$;

-- Immutable pending rows: existing main/legacy PATCH/Edge/vehicle RPCs cannot
-- activate, rename, reassign or delete an incomplete registration.
create function public.guard_employee_registration() returns trigger
language plpgsql security definer set search_path='' set row_security=off as $$
declare o public.employee_creation_operations;
begin
 select * into o from public.employee_creation_operations where employee_id=old.id and state<>'completed' order by created_at limit 1;
 if not found then if tg_op='DELETE' then return old; else return new; end if; end if;
 perform pg_catalog.pg_advisory_xact_lock(726314923);
 select * into o from public.employee_creation_operations where operation_id=o.operation_id for update;
 if o.state='completed' then if tg_op='DELETE' then return old; else return new; end if; end if;
 if tg_op='DELETE' then raise exception 'employee_registration_pending'; end if;
 if o.protocol=2
 and (to_jsonb(new)-'auth_user_id'-'active')=(to_jsonb(old)-'auth_user_id'-'active')
 and ((o.state='auth_bound' and new.auth_user_id=o.auth_id and new.active is false and (old.active is false or old.auth_user_id=o.auth_id))
   or (o.state='releasing' and new.auth_user_id=o.auth_id and old.auth_user_id=o.auth_id and new.active=(o.requested->>'active')::boolean))
 then return new; end if;
 raise exception 'employee_registration_pending';
end; $$;
-- The only allowed pending changes exactly match a transition authorized and
-- committed by the private operation RPC. No caller-supplied bypass flag exists.
create trigger employee_registration_pending before update or delete on public.employees
 for each row execute function public.guard_employee_registration();

create function public.advance_employee_registration(p_actor uuid,p_operation uuid,p_worker uuid,p_step text,p_auth uuid default null) returns jsonb
language plpgsql security definer set search_path='' set row_security=off as $$
declare o public.employee_creation_operations; u auth.users; e public.employees;
begin
 perform pg_catalog.pg_advisory_xact_lock(726314923);
 perform public.employee_registration_actor(p_actor);
 select * into o from public.employee_creation_operations where operation_id=p_operation and protocol=2 for update;
 if not found then raise exception 'safe_operation_required'; end if;
 if o.state='completed' then return public.employee_registration_completed(o.operation_id); end if;
 if p_worker is null or o.worker_token is distinct from p_worker then raise exception 'stale_worker'; end if;
 select * into u from auth.users where id=coalesce(o.auth_id,p_auth)
  and email='employee-'||o.employee_id||'@staff-portal.local'
  and raw_app_meta_data->>'employee_creation_operation'=o.operation_id::text;
 if u.id is null then raise exception 'auth_identity_requires_review'; end if;
 select * into e from public.employees where id=o.employee_id for update;
 if e.id is null or exists(select 1 from public.employees other where other.auth_user_id=u.id and other.id<>o.employee_id)
 then raise exception 'employee_auth_conflict'; end if;
 if p_step='bind' and o.state='auth_creating' then
  if u.banned_until is null or u.banned_until<=clock_timestamp() or u.raw_app_meta_data->>'employee_creation_phase' is distinct from 'isolated'
   or e.auth_user_id is not null or e.active is not false then raise exception 'auth_isolation_required'; end if;
  update public.employee_creation_operations set auth_id=u.id,state='auth_bound',last_actor=p_actor,updated_at=clock_timestamp() where operation_id=p_operation;
  update public.employees set auth_user_id=u.id where id=e.id;
 elsif p_step='release' and o.state='auth_bound' then
  if e.auth_user_id is distinct from u.id or e.active is not false or u.banned_until is null or u.banned_until<=clock_timestamp()
   or u.raw_app_meta_data->>'employee_creation_phase' is distinct from 'isolated' then raise exception 'auth_isolation_required'; end if;
  -- Commit the employee's complete business identity before external Auth release.
  -- Releasing is a one-shot grant: recovery NEVER repeats this external request.
  update public.employee_creation_operations set state='releasing',last_actor=p_actor,updated_at=clock_timestamp() where operation_id=p_operation;
  update public.employees set active=(o.requested->>'active')::boolean where id=e.id;
 elsif p_step='release_rejected' and o.state='releasing' then
  -- Only after a definitive Auth 400/422 rejection, never on timeout/5xx.
  if u.banned_until is null or u.banned_until<=clock_timestamp()
   or u.raw_app_meta_data->>'employee_creation_phase' is distinct from 'isolated'
  then raise exception 'auth_isolation_required'; end if;
  update public.employee_creation_operations set state='auth_bound',last_actor=p_actor,updated_at=clock_timestamp() where operation_id=p_operation;
  update public.employees set active=false where id=e.id;
 elsif p_step='complete' and o.state='releasing' then
  if e.auth_user_id is distinct from u.id or e.active is distinct from (o.requested->>'active')::boolean
   or u.email_confirmed_at is null
   or (u.banned_until is not null and u.banned_until>clock_timestamp())
   or u.raw_app_meta_data->>'employee_creation_phase' is distinct from 'released'
  then raise exception 'auth_release_unconfirmed'; end if;
  update public.employee_creation_operations set state='completed',last_actor=p_actor,updated_at=clock_timestamp() where operation_id=p_operation;
 else raise exception 'invalid_registration_transition'; end if;
 select * into o from public.employee_creation_operations where operation_id=p_operation;
 return jsonb_build_object('state',o.state,'employeeId',o.employee_id,'authId',o.auth_id,'operationId',o.operation_id);
end; $$;

-- Another currently authorized full admin may recover, without impersonating
-- the original operator. Stale workers are fenced by a fresh worker token.
create function public.recover_employee_registration(p_actor uuid,p_operation uuid,p_worker uuid) returns jsonb
language plpgsql security definer set search_path='' set row_security=off as $$
declare o public.employee_creation_operations; u auth.users; matches integer;
begin
 perform pg_catalog.pg_advisory_xact_lock(726314923);
 perform public.employee_registration_actor(p_actor);
 select * into o from public.employee_creation_operations where operation_id=p_operation and protocol=2 for update;
 if not found or p_worker is null then raise exception 'safe_operation_required'; end if;
 if o.state='completed' then return public.employee_registration_completed(o.operation_id); end if;
 select count(*) into matches from auth.users where email='employee-'||o.employee_id||'@staff-portal.local'
  and raw_app_meta_data->>'employee_creation_operation'=o.operation_id::text;
 if matches<>1 then raise exception 'auth_creation_unknown_no_recreate'; end if;
 select * into u from auth.users where email='employee-'||o.employee_id||'@staff-portal.local'
  and raw_app_meta_data->>'employee_creation_operation'=o.operation_id::text;
 if o.auth_id is not null and o.auth_id<>u.id then raise exception 'auth_identity_requires_review'; end if;
 update public.employee_creation_operations set worker_token=p_worker,last_actor=p_actor,updated_at=clock_timestamp() where operation_id=p_operation;
 if o.state='auth_creating' then
  perform public.advance_employee_registration(p_actor,p_operation,p_worker,'bind',u.id);
  o.state:='auth_bound';
 elsif o.state='releasing' then
  -- A delayed original release may still be in flight. Never reset a password
  -- or unban a second time, even when a status read currently shows a ban.
  perform public.advance_employee_registration(p_actor,p_operation,p_worker,'complete',u.id);
  o.state:='completed';
 elsif o.state<>'auth_bound' then raise exception 'manual_recovery_required'; end if;
 return jsonb_build_object('state',o.state,'employeeId',o.employee_id,'authId',u.id,'operationId',o.operation_id);
end; $$;

create or replace function public.employee_edit_context() returns jsonb
language plpgsql stable security definer set search_path='' set row_security=off as $$
declare a public.employees; n integer;
begin
 select count(*) into n from public.employees where auth_user_id=auth.uid();
 select * into a from public.employees where auth_user_id=auth.uid() and active;
 if auth.uid() is null or n<>1 or a.id is null or a.admin_scope is null or a.admin_scope not in ('all','工事部','技術部','営業部','総務部')
 or exists(select 1 from public.employee_creation_operations o where o.employee_id=a.id and o.state<>'completed')
 then raise exception 'employee_manager_required' using errcode='42501'; end if;
 return jsonb_build_object('all',a.admin_scope='all','actor_id',a.id,'registration_protocol',2,
  'creation_enabled',a.admin_scope='all' and (select enabled from public.employee_registration_settings where singleton) and public.employee_registration_ready(),
  'creation_management_enabled',a.admin_scope='all','department',case when a.admin_scope<>'all' then a.admin_scope end,
  'editable_ids',(select coalesce(jsonb_agg(e.id order by e.id),'[]'::jsonb) from public.employees e
   where not exists(select 1 from public.employee_creation_operations o where o.employee_id=e.id and o.state<>'completed')
    and (a.admin_scope='all' or (e.department=a.admin_scope and e.admin_scope='none' and e.is_leave_manager is false
     and not exists(select 1 from public.fuel_receipt_roles r where r.employee_id=e.id)))));
end; $$;

-- Legacy finish must not bypass isolation. The private begin is reused only by
-- begin_employee_registration; old/legacy operations need separate reconciliation.
revoke all on function public.begin_employee_creation(uuid,uuid,jsonb),public.finish_employee_creation(uuid,uuid,uuid,text) from public,anon,authenticated,service_role;
do $$
declare f record; a record;
begin
 for f in select oid,proowner,proacl from pg_catalog.pg_proc where pronamespace='public'::regnamespace and proname in
 ('employee_registration_actor','employee_registration_ready','employee_registration_completed','begin_employee_registration','advance_employee_registration','recover_employee_registration','guard_employee_registration',
  'begin_employee_creation','finish_employee_creation','employee_creation_status') loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role',f.oid::regprocedure);
  for a in select distinct grantee from pg_catalog.aclexplode(f.proacl) where grantee<>0 and grantee<>f.proowner loop
   execute format('revoke all on function %s from %I',f.oid::regprocedure,pg_catalog.pg_get_userbyid(a.grantee));
  end loop;
 end loop;
end; $$;
grant execute on function public.begin_employee_registration(uuid,uuid,jsonb,uuid),public.advance_employee_registration(uuid,uuid,uuid,text,uuid),
 public.recover_employee_registration(uuid,uuid,uuid),public.employee_creation_status(uuid,uuid) to service_role;
do $$
declare t record; a record;
begin
 for t in select oid,relowner,relacl from pg_catalog.pg_class where oid in
 ('public.employee_creation_operations'::regclass,'public.employee_registration_settings'::regclass) loop
  for a in select distinct grantee from pg_catalog.aclexplode(t.relacl) where grantee<>0 and grantee<>t.relowner loop
   execute format('revoke all on table %s from %I',t.oid::regclass,pg_catalog.pg_get_userbyid(a.grantee));
  end loop;
 end loop;
end; $$;
notify pgrst,'reload schema';
commit;
