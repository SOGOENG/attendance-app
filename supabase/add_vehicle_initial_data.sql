-- Preparation only. Apply manually as table owner AFTER vehicle/default-vehicle
-- and previous_vehicle_end_odometer migrations. Never creates synthetic reports.
begin;
set local search_path=pg_catalog,public;
-- Serialize repeated installation with this feature's writes and assignments.
select pg_catalog.pg_advisory_xact_lock(726314923);
create table if not exists public.vehicle_initial_data (
  vehicle_id bigint primary key references public.vehicles(id),
  baseline_date date not null,
  end_odometer numeric(11,1) not null check(end_odometer>=0 and end_odometer<=9999999999.9),
  refueled_date date,
  refuel_odometer numeric(11,1),
  liters numeric(9,3),
  fuel_station text,
  payment_method text,
  created_by bigint not null references public.employees(id),
  updated_by bigint not null references public.employees(id),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  revision bigint not null default 1,
  check ((refueled_date is null and refuel_odometer is null and liters is null
    and fuel_station is null and payment_method is null)
    or (refueled_date is not null and refueled_date<=baseline_date
      and refuel_odometer is not null and refuel_odometer>=0 and refuel_odometer<=end_odometer
      and liters is not null and liters>0 and liters<=999999.999)),
  check(length(fuel_station)<=200 and length(payment_method)<=100)
);
lock table public.vehicle_initial_data in access exclusive mode;
-- IF NOT EXISTS alone is unsafe: reject a same-name incompatible table.
-- This supports the original version of this migration without modifying rows.
do $$
begin
  if not exists(select 1 from pg_catalog.pg_class where oid='public.vehicle_initial_data'::regclass
    and relkind='r' and relowner=(select oid from pg_catalog.pg_roles where rolname=current_user))
    or exists(select 1 from pg_catalog.pg_policy where polrelid='public.vehicle_initial_data'::regclass)
    or exists(select 1 from pg_catalog.pg_trigger where tgrelid='public.vehicle_initial_data'::regclass and not tgisinternal)
  then raise exception 'vehicle_initial_data_schema_mismatch'; end if;
  if (select array_agg(attname||':'||pg_catalog.format_type(atttypid,atttypmod)||':'||attnotnull::text order by attnum)
      from pg_catalog.pg_attribute where attrelid='public.vehicle_initial_data'::regclass and attnum>0 and not attisdropped)
    is distinct from array['vehicle_id:bigint:true','baseline_date:date:true','end_odometer:numeric(11,1):true',
      'refueled_date:date:false','refuel_odometer:numeric(11,1):false','liters:numeric(9,3):false',
      'fuel_station:text:false','payment_method:text:false','created_by:bigint:true','updated_by:bigint:true',
      'created_at:timestamp with time zone:true','updated_at:timestamp with time zone:true','revision:bigint:true']
  then raise exception 'vehicle_initial_data_schema_mismatch'; end if;
  if exists(
    with actual as (
      select lower(regexp_replace(pg_catalog.pg_get_constraintdef(oid),'[[:space:]()]','','g')) definition
      from pg_catalog.pg_constraint where conrelid='public.vehicle_initial_data'::regclass and contype<>'n'
    ), expected as (
      select lower(regexp_replace(definition,'[[:space:]()]','','g')) definition from unnest(array[
        'PRIMARY KEY (vehicle_id)',
        'FOREIGN KEY (vehicle_id) REFERENCES vehicles(id)',
        'FOREIGN KEY (created_by) REFERENCES employees(id)',
        'FOREIGN KEY (updated_by) REFERENCES employees(id)',
        'CHECK (((end_odometer >= (0)::numeric) AND (end_odometer <= 9999999999.9)))',
        'CHECK (((length(fuel_station) <= 200) AND (length(payment_method) <= 100)))',
        'CHECK ((((refueled_date IS NULL) AND (refuel_odometer IS NULL) AND (liters IS NULL) AND (fuel_station IS NULL) AND (payment_method IS NULL)) OR ((refueled_date IS NOT NULL) AND (refueled_date <= baseline_date) AND (refuel_odometer IS NOT NULL) AND (refuel_odometer >= (0)::numeric) AND (refuel_odometer <= end_odometer) AND (liters IS NOT NULL) AND (liters > (0)::numeric) AND (liters <= 999999.999))))'
      ]) definition
    )
    (select * from actual except select * from expected) union all
    (select * from expected except select * from actual)
  ) or exists(select 1 from pg_catalog.pg_constraint where conrelid='public.vehicle_initial_data'::regclass
    and (not convalidated or condeferrable)) then raise exception 'vehicle_initial_data_schema_mismatch'; end if;
  if (select array_agg(a.attname||':'||pg_catalog.pg_get_expr(d.adbin,d.adrelid) order by a.attnum)
    from pg_catalog.pg_attrdef d join pg_catalog.pg_attribute a on a.attrelid=d.adrelid and a.attnum=d.adnum
    where d.adrelid='public.vehicle_initial_data'::regclass)
    is distinct from array['created_at:clock_timestamp()','updated_at:clock_timestamp()','revision:1']
  then raise exception 'vehicle_initial_data_schema_mismatch'; end if;
end;
$$;
alter table public.vehicle_initial_data enable row level security;
-- No direct client table grants or policies. All access is checked inside RPCs.
revoke all on public.vehicle_initial_data from public,anon,authenticated,service_role;

create or replace function public.can_use_vehicle_initial_data(p_vehicle_id bigint)
returns boolean language sql stable security definer set search_path='' set row_security=off as $$
  select auth.uid() is not null and exists(
    select 1 from public.employees e where e.id=public.current_employee_id()
      and e.auth_user_id=auth.uid() and e.active
      and (coalesce(public.is_application_admin(),false) or (
        exists(select 1 from public.vehicles v where v.id=p_vehicle_id and v.active)
        and not exists(select 1 from public.employees other
          where other.default_vehicle_id=p_vehicle_id and other.id<>e.id)
        and (e.default_vehicle_id=p_vehicle_id or exists(
          select 1 from public.driving_reports r where r.employee_id=e.id
            and r.vehicle_id=p_vehicle_id and r.driving_status='driven'
            and r.report_date<=(statement_timestamp() at time zone 'Asia/Tokyo')::date
        )))));
$$;

create or replace function public.my_initial_data_vehicles()
returns table(id bigint,vehicle_number text,vehicle_name text)
language sql stable security definer set search_path='' set row_security=off as $$
  select v.id,v.vehicle_number,v.vehicle_name from public.vehicles v
    where public.can_use_vehicle_initial_data(v.id) order by v.vehicle_number,v.id;
$$;

create or replace function public.get_vehicle_initial_data(p_vehicle_id bigint,p_report_date date)
returns jsonb language plpgsql stable security definer set search_path='' set row_security=off as $$
declare v_initial public.vehicle_initial_data; v_refuel jsonb;
begin
  if not public.can_use_vehicle_initial_data(p_vehicle_id) then
    raise exception 'vehicle_initial_access_denied' using errcode='42501'; end if;
  if p_report_date is null or p_report_date>(statement_timestamp() at time zone 'Asia/Tokyo')::date then
    raise exception 'invalid_report_date'; end if;
  select * into v_initial from public.vehicle_initial_data where vehicle_id=p_vehicle_id;
  -- Actual submitted fuel history always wins over the seed. No CSV changes.
  select jsonb_build_object('source','report','refueled_date',(f.refueled_at at time zone 'Asia/Tokyo')::date,
      'refuel_odometer',f.odometer_km,'liters',f.liters,'fuel_station',f.fuel_station,'payment_method',f.payment_method)
    into v_refuel from public.driving_refuels f join public.driving_reports r on r.id=f.driving_report_id
    where r.vehicle_id=p_vehicle_id and r.status='submitted'
      and r.report_date<p_report_date and f.refueled_at<(p_report_date::timestamp at time zone 'Asia/Tokyo')
    order by f.refueled_at desc,f.id desc limit 1;
  if v_refuel is null and v_initial.baseline_date<p_report_date and v_initial.refueled_date is not null then
    v_refuel:=jsonb_build_object('source','initial','refueled_date',v_initial.refueled_date,
      'refuel_odometer',v_initial.refuel_odometer,'liters',v_initial.liters,
      'fuel_station',v_initial.fuel_station,'payment_method',v_initial.payment_method);
  end if;
  return jsonb_build_object('initial',case when v_initial.vehicle_id is null then null else to_jsonb(v_initial) end,
    'can_edit',coalesce(public.is_application_admin(),false) or v_initial.vehicle_id is null or v_initial.created_by=public.current_employee_id(),
    'has_meter_history',exists(select 1 from public.driving_reports where vehicle_id=p_vehicle_id
      and report_date<p_report_date and driving_status='driven' and end_odometer is not null),
    'has_history',exists(select 1 from public.driving_reports where vehicle_id=p_vehicle_id
      and report_date<p_report_date and status='submitted'), 'previous_refuel',v_refuel);
end;
$$;

create or replace function public.save_vehicle_initial_data(p_vehicle_id bigint,p_baseline_date date,p_end_odometer numeric,
  p_refueled_date date,p_refuel_odometer numeric,p_liters numeric,p_fuel_station text,p_payment_method text,
  p_expected_revision bigint)
returns jsonb language plpgsql security definer set search_path='' set row_security=off as $$
declare v_actor bigint:=public.current_employee_id(); v_old public.vehicle_initial_data; v_saved public.vehicle_initial_data;
begin
  -- Same assignment lock as set_my_default_vehicle/admin assignment RPCs.
  perform pg_catalog.pg_advisory_xact_lock(726314923);
  if not public.can_use_vehicle_initial_data(p_vehicle_id) then
    raise exception 'vehicle_initial_access_denied' using errcode='42501'; end if;
  perform 1 from public.employees where id=v_actor and active and auth_user_id=auth.uid() for share;
  if not found then raise exception 'active_employee_required'; end if;
  perform 1 from public.vehicles where id=p_vehicle_id for share;
  if not found then raise exception 'vehicle_required'; end if;
  if not public.can_use_vehicle_initial_data(p_vehicle_id) then
    raise exception 'vehicle_initial_access_denied' using errcode='42501'; end if;
  select * into v_old from public.vehicle_initial_data where vehicle_id=p_vehicle_id for update;
  if v_old.vehicle_id is not null and not coalesce(public.is_application_admin(),false) and v_old.created_by<>v_actor then
    raise exception 'initial_creator_required' using errcode='42501'; end if;
  if (v_old.vehicle_id is null and p_expected_revision is not null)
    or (v_old.vehicle_id is not null and p_expected_revision is distinct from v_old.revision) then
    raise exception 'initial_revision_conflict'; end if;
  if p_baseline_date is null or p_baseline_date>(statement_timestamp() at time zone 'Asia/Tokyo')::date
    or p_end_odometer is null or p_end_odometer<0 or p_end_odometer>9999999999.9
    or p_end_odometer<>round(p_end_odometer,1)
    or (p_refuel_odometer is not null and p_refuel_odometer<>round(p_refuel_odometer,1))
    or (p_liters is not null and p_liters<>round(p_liters,3)) then
    raise exception 'invalid_initial_values'; end if;
  insert into public.vehicle_initial_data(vehicle_id,baseline_date,end_odometer,refueled_date,refuel_odometer,
    liters,fuel_station,payment_method,created_by,updated_by)
  values(p_vehicle_id,p_baseline_date,p_end_odometer,p_refueled_date,p_refuel_odometer,p_liters,
    nullif(trim(p_fuel_station),''),nullif(trim(p_payment_method),''),v_actor,v_actor)
  on conflict(vehicle_id) do update set baseline_date=excluded.baseline_date,end_odometer=excluded.end_odometer,
    refueled_date=excluded.refueled_date,refuel_odometer=excluded.refuel_odometer,liters=excluded.liters,
    fuel_station=excluded.fuel_station,payment_method=excluded.payment_method,updated_by=v_actor,
    updated_at=clock_timestamp(),revision=public.vehicle_initial_data.revision+1
  returning * into v_saved;
  return to_jsonb(v_saved);
end;
$$;

create or replace function public.previous_vehicle_end_odometer(p_vehicle_id bigint,p_report_date date)
returns numeric language plpgsql stable security definer set search_path='' set row_security=off as $$
declare v_date date; v_value numeric;
begin
  if auth.uid() is null or public.current_employee_id() is null then raise exception 'active_employee_required'; end if;
  if p_report_date is null or p_report_date>(statement_timestamp() at time zone 'Asia/Tokyo')::date then
    raise exception 'invalid_report_date'; end if;
  if p_vehicle_id is null or not exists(select 1 from public.vehicles where id=p_vehicle_id
    and (active or coalesce(public.is_application_admin(),false))) then return null; end if;
  -- Preserve existing meter-read entitlement; editing a seed is stricter.
  if not coalesce(public.is_application_admin(),false) and not exists(select 1 from public.employees
    where id=public.current_employee_id() and auth_user_id=auth.uid() and active and default_vehicle_id=p_vehicle_id)
    and not exists(select 1 from public.driving_reports where employee_id=public.current_employee_id()
      and vehicle_id=p_vehicle_id and driving_status='driven' and report_date<=p_report_date) then
    raise exception 'vehicle_odometer_access_denied' using errcode='42501'; end if;
  select max(report_date) into v_date from public.driving_reports where vehicle_id=p_vehicle_id
    and report_date<p_report_date and driving_status='driven' and end_odometer is not null;
  if v_date is not null then
    select case when count(distinct end_odometer)=1 then max(end_odometer) else null end into v_value
      from public.driving_reports where vehicle_id=p_vehicle_id and report_date=v_date
        and driving_status='driven' and end_odometer is not null;
    return v_value; -- conflicting real history must never fall back to a seed
  end if;
  if exists(select 1 from public.driving_reports where vehicle_id=p_vehicle_id
    and report_date<p_report_date and status='submitted') then return null; end if;
  select end_odometer into v_value from public.vehicle_initial_data
    where vehicle_id=p_vehicle_id and baseline_date<p_report_date;
  return v_value;
end;
$$;
revoke all on function public.my_initial_data_vehicles(),public.can_use_vehicle_initial_data(bigint),public.get_vehicle_initial_data(bigint,date),
 public.save_vehicle_initial_data(bigint,date,numeric,date,numeric,numeric,text,text,bigint),
 public.previous_vehicle_end_odometer(bigint,date) from public,anon,authenticated,service_role;
grant execute on function public.my_initial_data_vehicles(),public.can_use_vehicle_initial_data(bigint),public.get_vehicle_initial_data(bigint,date),
 public.save_vehicle_initial_data(bigint,date,numeric,date,numeric,numeric,text,text,bigint),
 public.previous_vehicle_end_odometer(bigint,date) to authenticated;
notify pgrst,'reload schema';
commit;
