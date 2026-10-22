-- PREPARATION ONLY. No automatic compensating DELETE: dependencies are unreviewed.
begin;
create table public.employee_creation_operations (
  operation_id uuid primary key,
  actor_auth_id uuid not null,
  employee_id bigint not null,
  requested jsonb not null,
  state text not null check(state in ('employee_created','completed','recovery_required')),
  failure_code text,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);
alter table public.employee_creation_operations enable row level security;
revoke all on public.employee_creation_operations from public,anon,authenticated,service_role;

create function public.begin_employee_creation(p_actor uuid,p_operation uuid,p_data jsonb)
returns jsonb language plpgsql security definer set search_path='' set row_security=off as $$
declare a public.employees; o public.employee_creation_operations; v_id bigint; k text; n integer;
begin
  perform pg_catalog.pg_advisory_xact_lock(726314923);
  select count(*) into n from public.employees where auth_user_id=p_actor;
  select * into a from public.employees where auth_user_id=p_actor and active for update;
  if p_actor is null or n<>1 or a.id is null or a.admin_scope is distinct from 'all' then
    raise exception 'employee_admin_required' using errcode='42501'; end if;
  if p_operation is null or jsonb_typeof(p_data) is distinct from 'object'
    or (select count(*) from jsonb_object_keys(p_data))<>7 then raise exception 'invalid_employee_values'; end if;
  foreach k in array array['name','department','admin_scope','active','attendance_required','improvement_required','near_miss_required'] loop
    if not p_data ? k or jsonb_typeof(p_data->k) is distinct from
      (case when k in ('name','department','admin_scope') then 'string' else 'boolean' end)
    then raise exception 'invalid_employee_values'; end if;
  end loop;
  if length(trim(p_data->>'name')) not between 1 and 100
    or p_data->>'department' not in ('工事部','技術部','営業部','総務部')
    or p_data->>'admin_scope' not in ('none','all','tool_admin','工事部','技術部','営業部','総務部')
  then raise exception 'invalid_employee_values'; end if;
  select * into o from public.employee_creation_operations where operation_id=p_operation for update;
  if found then
    if o.actor_auth_id<>p_actor or o.requested<>p_data then raise exception 'employee_operation_conflict'; end if;
    return jsonb_build_object('process',false,'state',o.state,'employeeId',o.employee_id,'operationId',o.operation_id);
  end if;
  -- Global assignment lock also serializes distinct operation IDs from tabs.
  -- Identical details are conservatively treated as an existing registration,
  -- including completed registrations; intentional namesakes need review.
  select * into o from public.employee_creation_operations where requested=p_data order by created_at limit 1 for update;
  if found then
    if o.actor_auth_id<>p_actor then raise exception 'employee_duplicate_requires_review'; end if;
    return jsonb_build_object('process',false,'state',o.state,'employeeId',o.employee_id,'operationId',o.operation_id);
  end if;
  -- Preserve production order and employee-ID based internal email. Inactive
  -- until final linkage, so partial creation does not become a usable employee.
  insert into public.employees(name,department,active,admin_scope,attendance_required,improvement_required,near_miss_required,auth_user_id)
  values(trim(p_data->>'name'),p_data->>'department',false,p_data->>'admin_scope',
    (p_data->>'attendance_required')::boolean,(p_data->>'improvement_required')::boolean,
    (p_data->>'near_miss_required')::boolean,null) returning id into v_id;
  insert into public.employee_creation_operations(operation_id,actor_auth_id,employee_id,requested,state)
  values(p_operation,p_actor,v_id,p_data,'employee_created');
  return jsonb_build_object('process',true,'state','employee_created','employeeId',v_id,'operationId',p_operation);
end;
$$;

create function public.finish_employee_creation(p_actor uuid,p_operation uuid,p_auth uuid,p_failure text)
returns jsonb language plpgsql security definer set search_path='' set row_security=off as $$
declare o public.employee_creation_operations; a public.employees; n integer;
begin
  perform pg_catalog.pg_advisory_xact_lock(726314923);
  select count(*) into n from public.employees where auth_user_id=p_actor;
  select * into a from public.employees where auth_user_id=p_actor and active for update;
  if n<>1 or a.id is null or a.admin_scope is distinct from 'all' then
    raise exception 'employee_admin_required' using errcode='42501'; end if;
  select * into o from public.employee_creation_operations where operation_id=p_operation for update;
  if not found or o.actor_auth_id<>p_actor then raise exception 'employee_operation_required'; end if;
  if o.state='completed' then return jsonb_build_object('state','completed','employeeId',o.employee_id); end if;
  if p_failure is not null then
    if p_failure not in ('auth_create_failed_or_unknown','link_failed_or_unknown') then raise exception 'invalid_failure_code'; end if;
    update public.employee_creation_operations set state='recovery_required',failure_code=p_failure,updated_at=clock_timestamp()
      where operation_id=p_operation;
    return jsonb_build_object('state','recovery_required','employeeId',o.employee_id);
  end if;
  if o.state<>'employee_created' or p_auth is null then raise exception 'employee_recovery_required'; end if;
  if exists(select 1 from public.employees where auth_user_id=p_auth) then raise exception 'employee_auth_conflict'; end if;
  update public.employees set auth_user_id=p_auth,active=(o.requested->>'active')::boolean
    where id=o.employee_id and auth_user_id is null and active is false;
  if not found then raise exception 'employee_creation_changed'; end if;
  update public.employee_creation_operations set state='completed',updated_at=clock_timestamp() where operation_id=p_operation;
  return jsonb_build_object('state','completed','employeeId',o.employee_id);
end;
$$;
-- Read-only status for full administrators, including another administrator's
-- interrupted operation. Does not expose Auth UUIDs or requested payloads.
create function public.employee_creation_status(p_actor uuid,p_operation uuid default null)
returns jsonb language plpgsql stable security definer set search_path='' set row_security=off as $$
declare n integer;
begin
  select count(*) into n from public.employees where auth_user_id=p_actor;
  if p_actor is null or n<>1 or not exists(select 1 from public.employees
    where auth_user_id=p_actor and active and admin_scope='all') then
    raise exception 'employee_admin_required' using errcode='42501'; end if;
  return (select coalesce(jsonb_agg(to_jsonb(s) order by s.created_at desc,s.operation_id),'[]'::jsonb) from (
    select o.operation_id,o.employee_id,o.state,o.failure_code,o.created_at,o.updated_at,
      e.id is not null as employee_exists,e.active as employee_active,
      e.auth_user_id is not null as employee_auth_linked
    from public.employee_creation_operations o left join public.employees e on e.id=o.employee_id
    where p_operation is null or o.operation_id=p_operation
    order by o.created_at desc,o.operation_id limit 50
  ) s);
end;
$$;
revoke all on function public.begin_employee_creation(uuid,uuid,jsonb),public.finish_employee_creation(uuid,uuid,uuid,text)
  from public,anon,authenticated,service_role;
grant execute on function public.begin_employee_creation(uuid,uuid,jsonb),public.finish_employee_creation(uuid,uuid,uuid,text) to service_role;
revoke all on function public.employee_creation_status(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.employee_creation_status(uuid,uuid) to service_role;
notify pgrst,'reload schema';
commit;
