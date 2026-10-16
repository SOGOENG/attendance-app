-- 本番未適用。add_employee_default_vehicle.sql 適用後、同じtable ownerで全体を実行。
-- 既存重複は自動修正しない。検出時は全体を停止して管理者が割り当てを確認する。
begin;
do $$
begin
  if exists(select 1 from public.employees where default_vehicle_id is not null
    group by default_vehicle_id having count(*)>1) then
    raise exception 'duplicate_default_vehicle_assignments'
      using hint='同じ車両を設定している社員を確認・解消してから再実行してください。';
  end if;
end;
$$;
-- Immediate UNIQUE also protects direct SQL / concurrent non-RPC writers.
-- NULL is repeatable. Reuse only the exact immediate, validated single-column
-- UNIQUE with ordinary NULL semantics; reject same-name but different definitions.
lock table public.employees in share row exclusive mode;
do $$
declare v_constraint record; v_column smallint;
begin
  select attnum into strict v_column from pg_catalog.pg_attribute
    where attrelid='public.employees'::regclass and attname='default_vehicle_id' and not attisdropped;
  select c.*,i.indisvalid,i.indisunique,i.indnullsnotdistinct,i.indpred,i.indexprs,
    i.indnkeyatts,i.indnatts into v_constraint
    from pg_catalog.pg_constraint c left join pg_catalog.pg_index i on i.indexrelid=c.conindid
    where c.conrelid='public.employees'::regclass and c.conname='employees_default_vehicle_unique';
  if found then
    if v_constraint.contype<>'u' or v_constraint.conkey is distinct from array[v_column]::smallint[]
      or v_constraint.condeferrable or v_constraint.condeferred or not v_constraint.convalidated
      or v_constraint.indisvalid is distinct from true or v_constraint.indisunique is distinct from true
      or v_constraint.indnullsnotdistinct is distinct from false
      or v_constraint.indpred is not null or v_constraint.indexprs is not null
      or v_constraint.indnkeyatts<>1 or v_constraint.indnatts<>1 then
      raise exception 'employees_default_vehicle_unique_definition_mismatch';
    end if;
  else
    alter table public.employees add constraint employees_default_vehicle_unique unique(default_vehicle_id);
  end if;
end;
$$;

create or replace function public.set_my_default_vehicle(p_vehicle_id bigint)
returns bigint language plpgsql security definer set search_path='' as $$
declare v_actor bigint := public.current_employee_id(); v_saved bigint;
begin
  -- Same lock, BEFORE row locks, for self settings and all admin assignment RPCs.
  perform pg_catalog.pg_advisory_xact_lock(726314923);
  if v_actor is null or auth.uid() is null then raise exception 'active_employee_required'; end if;
  perform 1 from public.employees where id=v_actor and auth_user_id=auth.uid() and active for update;
  if not found then raise exception 'active_employee_required'; end if;
  if p_vehicle_id is not null then
    perform 1 from public.vehicles where id=p_vehicle_id and active for share;
    if not found then raise exception 'active_vehicle_required'; end if;
    if exists(select 1 from public.employees where default_vehicle_id=p_vehicle_id and id<>v_actor) then
      raise exception 'vehicle_already_assigned';
    end if;
  end if;
  update public.employees set default_vehicle_id=p_vehicle_id
    where id=v_actor and auth_user_id=auth.uid() and active returning default_vehicle_id into v_saved;
  if not found then raise exception 'active_employee_required'; end if;
  return v_saved;
exception when unique_violation then raise exception 'vehicle_already_assigned';
end;
$$;

-- A single server snapshot; owner is derived from employees, never duplicated in vehicles.
create or replace function public.admin_get_vehicle_master()
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_result jsonb;
begin
  if public.is_application_admin() is distinct from true then raise exception 'application_admin_required'; end if;
  select jsonb_build_object(
    'vehicles',coalesce((select jsonb_agg(to_jsonb(v) order by v.vehicle_number,v.id) from public.vehicles v),'[]'::jsonb),
    'employees',coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'name',e.name,'department',e.department,
      'active',e.active,'default_vehicle_id',e.default_vehicle_id) order by e.id) from public.employees e),'[]'::jsonb),
    'assignments',coalesce((select jsonb_agg(jsonb_build_object('employee_id',e.id,'vehicle_id',e.default_vehicle_id)
      order by e.id) from public.employees e where e.default_vehicle_id is not null),'[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$$;

-- Vehicle + explicit affected-employee mapping + optional old-car deactivation:
-- all-or-nothing. Mapping vehicle_id="saved" refers to this newly saved vehicle.
-- A swap must include BOTH employees. No employee is silently unassigned.
-- expected_assignments is the exact array from admin_get_vehicle_master(); stale
-- assignment screens (including self-setting changes) must reload before saving.
create or replace function public.admin_save_vehicle_master(
  p_vehicle jsonb, p_assignments jsonb, p_expected_assignments jsonb,
  p_deactivate_ids bigint[] default array[]::bigint[])
returns bigint language plpgsql security definer set search_path='' as $$
declare
  v_id bigint; v_old public.vehicles%rowtype; v_snapshot jsonb;
  v_item jsonb; v_employee bigint; v_vehicle bigint; v_number text; v_name text;
begin
  perform pg_catalog.pg_advisory_xact_lock(726314923);
  if public.is_application_admin() is distinct from true then raise exception 'application_admin_required'; end if;
  if jsonb_typeof(p_vehicle) is distinct from 'object'
    or jsonb_typeof(p_assignments) is distinct from 'array'
    or jsonb_typeof(p_expected_assignments) is distinct from 'array' then
    raise exception 'invalid_vehicle_payload';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('employee_id',id,'vehicle_id',default_vehicle_id) order by id), '[]'::jsonb)
    into v_snapshot from public.employees where default_vehicle_id is not null;
  if v_snapshot is distinct from p_expected_assignments then raise exception 'vehicle_assignments_changed'; end if;
  v_number:=nullif(btrim(p_vehicle->>'vehicle_number'),'');
  v_name:=nullif(btrim(p_vehicle->>'vehicle_name'),'');
  if v_number is null or length(v_number)>100 or v_name is null or length(v_name)>100
    or length(coalesce(p_vehicle->>'note',''))>2000
    or jsonb_typeof(p_vehicle->'active') is distinct from 'boolean' then
    raise exception 'invalid_vehicle_fields';
  end if;
  v_id:=(p_vehicle->>'id')::bigint;
  if v_id is not null then
    select * into v_old from public.vehicles where id=v_id for update;
    if not found then raise exception 'vehicle_not_found'; end if;
    if v_old.updated_at is distinct from (p_vehicle->>'expected_updated_at')::timestamptz then
      raise exception 'vehicle_changed';
    end if;
    update public.vehicles set vehicle_number=v_number,vehicle_name=v_name,
      active=(p_vehicle->>'active')::boolean,note=nullif(btrim(p_vehicle->>'note'),'') where id=v_id;
  else
    insert into public.vehicles(vehicle_number,vehicle_name,active,note)
      values(v_number,v_name,(p_vehicle->>'active')::boolean,nullif(btrim(p_vehicle->>'note'),'')) returning id into v_id;
  end if;
  if (select count(*) from jsonb_array_elements(p_assignments)) <>
    (select count(distinct (x->>'employee_id')::bigint) from jsonb_array_elements(p_assignments) x) then
    raise exception 'duplicate_assignment_employee';
  end if;
  -- Lock involved employees in a stable order; validate everything before clearing.
  perform 1 from public.employees where id in
    (select (x->>'employee_id')::bigint from jsonb_array_elements(p_assignments) x) order by id for update;
  for v_item in select * from jsonb_array_elements(p_assignments) loop
    v_employee:=(v_item->>'employee_id')::bigint;
    v_vehicle:=case when v_item->>'vehicle_id'='saved' then v_id else (v_item->>'vehicle_id')::bigint end;
    perform 1 from public.employees where id=v_employee and (v_vehicle is null or active);
    if not found then raise exception 'active_assignment_employee_required'; end if;
    if v_vehicle is not null then
      perform 1 from public.vehicles where id=v_vehicle and active for share;
      if not found then raise exception 'active_vehicle_required'; end if;
      if v_vehicle=any(coalesce(p_deactivate_ids,array[]::bigint[])) then raise exception 'cannot_assign_deactivated_vehicle'; end if;
    end if;
  end loop;
  -- Clear ONLY explicitly involved employees, then assign. Immediate uniqueness
  -- is never disabled/deferred, and outside transactions never observe the gap.
  update public.employees set default_vehicle_id=null where id in
    (select (x->>'employee_id')::bigint from jsonb_array_elements(p_assignments) x);
  for v_item in select * from jsonb_array_elements(p_assignments) loop
    v_vehicle:=case when v_item->>'vehicle_id'='saved' then v_id else (v_item->>'vehicle_id')::bigint end;
    update public.employees set default_vehicle_id=v_vehicle where id=(v_item->>'employee_id')::bigint;
  end loop;
  if exists(select 1 from unnest(p_deactivate_ids) x where x is null
    or not exists(select 1 from public.vehicles where id=x)) then raise exception 'vehicle_not_found'; end if;
  update public.vehicles set active=false where id=any(p_deactivate_ids);
  -- Check the FINAL assignment state, after swaps/replacements/clears. Any
  -- remaining owner makes the whole RPC (including vehicle INSERTs) roll back.
  if exists(select 1 from public.employees e where e.default_vehicle_id is not null and (
    (e.default_vehicle_id=v_id and not (p_vehicle->>'active')::boolean)
    or e.default_vehicle_id=any(p_deactivate_ids))) then
    raise exception 'deactivated_vehicle_still_assigned';
  end if;
  return v_id;
exception when unique_violation then
  -- Includes duplicate plate and assignment: the entire RPC rolls back.
  raise exception 'vehicle_number_or_assignment_conflict';
end;
$$;
revoke all on function public.set_my_default_vehicle(bigint),public.admin_get_vehicle_master(),
  public.admin_save_vehicle_master(jsonb,jsonb,jsonb,bigint[]) from public,anon,authenticated;
grant execute on function public.set_my_default_vehicle(bigint),public.admin_get_vehicle_master(),
  public.admin_save_vehicle_master(jsonb,jsonb,jsonb,bigint[]) to authenticated;
-- No employee grants/RLS changes, no vehicle DELETE, no driving_report updates.
commit;
