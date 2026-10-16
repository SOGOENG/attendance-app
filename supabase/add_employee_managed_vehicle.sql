-- 本番未適用。add_vehicle_master_management.sql 適用後に全体を実行。
-- No backfill / UPDATE of existing reports. Old missing names remain NULL.
begin;
-- Stop rather than silently attach to an unexpected/disabled base trigger.
-- This checks the required repository contract, not every production-only trigger.
do $$
begin
  if not exists(select 1 from pg_catalog.pg_trigger t
    where t.tgrelid='public.driving_reports'::regclass and t.tgname='driving_report_prepare'
      and t.tgfoid='public.driving_report_prepare()'::regprocedure
      and t.tgtype=23 and t.tgenabled in ('O','A') and not t.tgisinternal) then
    raise exception 'driving_report_prepare_trigger_incompatible';
  end if;
  if pg_catalog.to_regprocedure('public.admin_get_vehicle_master()') is null
    or pg_catalog.to_regprocedure('public.admin_save_vehicle_master(jsonb,jsonb,jsonb,bigint[])') is null then
    raise exception 'vehicle_master_management_migration_required';
  end if;
end;
$$;
alter table public.driving_reports add column vehicle_name_snapshot text;
comment on column public.driving_reports.vehicle_name_snapshot is
  '当時の車両名。導入前の日報は未保存(NULL)のまま保持する。';

-- This trigger sorts AFTER driving_report_prepare; existing identity, submission,
-- audit and late-entry logic stays unchanged. Only new/changed vehicle selections
-- get new snapshots; unrelated corrections preserve OLD values, including NULL.
create function public.driving_report_vehicle_snapshot_prepare()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.employee_id is distinct from public.current_employee_id() then raise exception 'own_report_required'; end if;
  if tg_op='INSERT' or new.vehicle_id is distinct from old.vehicle_id then
    new.vehicle_number_snapshot:=null;
    new.vehicle_name_snapshot:=null;
    if new.vehicle_id is not null then
      select v.vehicle_number,v.vehicle_name into new.vehicle_number_snapshot,new.vehicle_name_snapshot
        from public.vehicles v where v.id=new.vehicle_id and v.active for share;
      if not found then raise exception 'active_vehicle_required'; end if;
    end if;
  else
    new.vehicle_number_snapshot:=old.vehicle_number_snapshot;
    new.vehicle_name_snapshot:=old.vehicle_name_snapshot;
  end if;
  return new;
end;
$$;
create trigger driving_report_vehicle_snapshot_prepare before insert or update on public.driving_reports
  for each row execute function public.driving_report_vehicle_snapshot_prepare();

-- Employee-centered admin entry point. Registration numbers identify existing cars.
-- Never UPDATE an existing car's number or name. An existing-number/name mismatch
-- is rejected rather than relabeling old records. Transfers require the source ID
-- explicitly acknowledged by the administrator (and a fresh assignment snapshot).
create function public.admin_set_employee_managed_vehicle(
  p_employee_id bigint,p_vehicle_number text,p_vehicle_name text,
  p_expected_assignments jsonb,p_expected_source_employee_id bigint default null)
returns bigint language plpgsql security definer set search_path='' as $$
declare
  v_employee public.employees%rowtype; v_car public.vehicles%rowtype;
  v_number text:=nullif(btrim(p_vehicle_number),''); v_name text:=nullif(btrim(p_vehicle_name),'');
  v_source bigint; v_existing boolean; v_mapping jsonb; v_payload jsonb; v_deactivate bigint[]:=array[]::bigint[];
begin
  perform pg_catalog.pg_advisory_xact_lock(726314923);
  if public.is_application_admin() is distinct from true then raise exception 'application_admin_required'; end if;
  if v_number is null or v_name is null or length(v_number)>100 or length(v_name)>100 then
    raise exception 'invalid_managed_vehicle_fields';
  end if;
  if (public.admin_get_vehicle_master()->'assignments') is distinct from p_expected_assignments then
    raise exception 'vehicle_assignments_changed';
  end if;
  select * into v_employee from public.employees where id=p_employee_id and active for update;
  if not found then raise exception 'active_assignment_employee_required'; end if;
  select * into v_car from public.vehicles where vehicle_number=v_number for update;
  v_existing:=found;
  if v_existing then
    if v_car.vehicle_name is distinct from v_name then raise exception 'managed_vehicle_name_mismatch'; end if;
    select id into v_source from public.employees
      where default_vehicle_id=v_car.id and id<>p_employee_id;
  end if;
  if v_source is distinct from p_expected_source_employee_id then raise exception 'managed_vehicle_source_changed'; end if;
  v_mapping:=jsonb_build_array(jsonb_build_object('employee_id',p_employee_id,'vehicle_id','saved'));
  if v_source is not null then
    v_mapping:=v_mapping || jsonb_build_array(jsonb_build_object('employee_id',v_source,'vehicle_id',null));
  end if;
  if v_employee.default_vehicle_id is not null and v_employee.default_vehicle_id is distinct from v_car.id then
    v_deactivate:=array[v_employee.default_vehicle_id];
  end if;
  if v_existing then
    v_payload:=jsonb_build_object('id',v_car.id,'expected_updated_at',v_car.updated_at,
      'vehicle_number',v_number,'vehicle_name',v_name,'active',true,'note',v_car.note);
  else
    -- Explicit JSON null becomes SQL NULL via ->>; admin_save_vehicle_master
    -- takes its INSERT branch and does not compare an old updated_at.
    v_payload:=jsonb_build_object('id',null,'expected_updated_at',null,
      'vehicle_number',v_number,'vehicle_name',v_name,'active',true,'note',null);
  end if;
  return public.admin_save_vehicle_master(v_payload,v_mapping,p_expected_assignments,v_deactivate);
end;
$$;
revoke all on function public.driving_report_vehicle_snapshot_prepare(),
  public.admin_set_employee_managed_vehicle(bigint,text,text,jsonb,bigint) from public,anon,authenticated;
grant execute on function public.admin_set_employee_managed_vehicle(bigint,text,text,jsonb,bigint) to authenticated;
-- employees.default_vehicle_id remains the single source of the current car.
-- No changes to RLS, employee profile fields, self RPC, uniqueness or report ownership.
notify pgrst,'reload schema';
commit;
