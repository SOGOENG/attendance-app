-- 本番適用用 migration（準備のみ。今回はSupabaseに実行しない）。
-- Run the entire file as the database owner, never selected fragments.
-- Atomic and intentionally NOT idempotent: CREATE conflicts abort the transaction.
-- Existing objects/functions/RLS are never replaced or silently reused.
-- Requires employees(id,name,department,active), sites(id,display_name),
-- current_employee_id(), is_application_admin(), authenticated and anon roles.
-- 基本1日1人1車両。複数車両対応は将来拡張。
-- unique(employee_id, report_date) also supports employee / 21st-next-20th queries.
-- DELETE is not granted on any of the five tables (including details).
-- Submission is deliberately blocked until a separate migration implements the
-- authoritative validator below. Draft input is available after application.
begin;

create table public.vehicles (
  id bigint generated always as identity primary key,
  vehicle_number text not null unique check (btrim(vehicle_number) <> ''),
  vehicle_name text not null check (btrim(vehicle_name) <> ''),
  registration_number text,
  active boolean not null default true,
  note text,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp()
);

create table public.driving_reports (
  id bigint generated always as identity primary key,
  report_date date not null,
  employee_id bigint not null references public.employees(id) on delete restrict,
  -- Morning saves remain incomplete drafts; only the final update submits.
  status text not null default 'draft' check (status in ('draft','submitted')),
  vehicle_id bigint references public.vehicles(id) on delete restrict,
  driving_status text not null check (driving_status in ('driven','no_driving')),
  route_type text check (route_type in ('office','direct','direct_return','other')),
  route_note text,
  site_id bigint references public.sites(id) on delete restrict,
  site_name_snapshot text,
  employee_name_snapshot text not null,
  department_snapshot text,
  vehicle_number_snapshot text,
  start_odometer numeric(12,1) check (start_odometer between 0 and 9999999999.9),
  end_odometer numeric(12,1) check (end_odometer between 0 and 9999999999.9),
  distance_km numeric(12,1) generated always as (end_odometer-start_odometer) stored,
  accident_or_violation boolean not null default false,
  accident_violation_note text,
  note text,
  submitted_at timestamptz,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  created_by_employee_id bigint not null references public.employees(id) on delete restrict,
  updated_by_employee_id bigint not null references public.employees(id) on delete restrict,
  late_entry boolean,
  late_entry_days integer check (late_entry_days >= 0),
  unique (employee_id, report_date),
  check (end_odometer >= start_odometer),
  check (status='draft' or not accident_or_violation or nullif(btrim(accident_violation_note),'') is not null),
  check (status='draft' or submitted_at is not null),
  check (
    status='draft' or
    (driving_status='driven' and vehicle_id is not null and route_type is not null
      and start_odometer is not null and end_odometer is not null)
    or
    (driving_status='no_driving' and vehicle_id is null and route_type is null
      and route_note is null and site_id is null and site_name_snapshot is null
      and start_odometer is null and end_odometer is null
      and not accident_or_violation and accident_violation_note is null)
  )
);
create index driving_reports_date_employee_idx on public.driving_reports(report_date,employee_id);
create index driving_reports_vehicle_date_idx on public.driving_reports(vehicle_id,report_date)
  where vehicle_id is not null;

create table public.driving_report_inspections (
  driving_report_id bigint not null references public.driving_reports(id) on delete cascade,
  inspection_item_code text not null check (inspection_item_code ~ '^[a-z][a-z0-9_]{0,63}$'),
  result text not null check (result in ('ok','defect','not_applicable')),
  note text,
  checked_at timestamptz not null,
  primary key (driving_report_id, inspection_item_code),
  check (result <> 'defect' or nullif(btrim(note),'') is not null)
);
-- 正式13項目の名称・コードは未確定。架空コードや固定の13件検証は追加しない。
-- Detail rows remain usable for drafts; the future submission validator must
-- validate the exact official code set, not just accept any 13 rows.

create table public.driving_alcohol_checks (
  id bigint generated always as identity primary key,
  driving_report_id bigint not null references public.driving_reports(id) on delete cascade,
  check_type text not null check (check_type in ('before','after')),
  checked_at timestamptz not null,
  alcohol_value numeric(6,3) not null check (alcohol_value between 0 and 999.999),
  is_zero boolean generated always as (alcohol_value=0) stored,
  confirmation_method text not null check (btrim(confirmation_method) <> ''),
  confirmed_by_employee_id bigint references public.employees(id) on delete restrict,
  confirmed_by_name_snapshot text not null check (btrim(confirmed_by_name_snapshot) <> ''),
  note text,
  unique (driving_report_id, check_type)
);

create table public.driving_refuels (
  id bigint generated always as identity primary key,
  driving_report_id bigint not null references public.driving_reports(id) on delete cascade,
  refueled_at timestamptz not null,
  fuel_station text,
  payment_method text,
  liters numeric(9,3) not null check (liters > 0 and liters <= 999999.999),
  odometer_km numeric(12,1) check (odometer_km between 0 and 9999999999.9),
  note text
);
create index driving_refuels_report_time_idx on public.driving_refuels(driving_report_id,refueled_at,id);

-- Future migration MUST replace only this NEW validator (or introduce a secure
-- submission RPC plus equivalent DB enforcement). No client toggle/GUC bypass.
-- For driven reports validate: vehicle, route, start/end odometers, exact official
-- 13 inspection codes/results, before AND after alcohol checks, accident note.
-- For no_driving validate: no vehicle/site/route/odometers or driving details.
-- Re-submission must pass the same validation. Lock parent first, save details,
-- then update status last in one transaction; keep first submitted_at unchanged.
-- Until that migration, block ALL submissions, including no_driving, rather than
-- accepting records with incomplete safety checks. This is not an empty code list.
create function public.driving_report_validate_submission(p_report public.driving_reports)
returns void language plpgsql set search_path = '' as $$
begin
  raise exception 'driving_submission_not_available'
    using hint = '正式13点検と提出時検証を別migrationで確定してから提出を有効化してください。';
end;
$$;

-- Server-owned first submission, identity and snapshot values.
create function public.driving_report_prepare()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_actor bigint := public.current_employee_id();
  v_now timestamptz := statement_timestamp();
begin
  if v_actor is null then raise exception 'active_employee_required'; end if;
  if tg_op='INSERT' then
    if new.employee_id is distinct from v_actor then raise exception 'own_report_required'; end if;
    if new.report_date > (v_now at time zone 'Asia/Tokyo')::date then
      raise exception 'future_report_date_not_allowed';
    end if;
    if new.status <> 'draft' then raise exception 'new_report_must_be_draft'; end if;
    new.submitted_at := null;
    new.created_at := v_now;
    new.created_by_employee_id := v_actor;
    select e.name,e.department into new.employee_name_snapshot,new.department_snapshot
      from public.employees e where e.id=v_actor;
  else
    if old.employee_id is distinct from v_actor then raise exception 'own_report_required'; end if;
    if new.id is distinct from old.id or new.employee_id is distinct from old.employee_id
       or new.report_date is distinct from old.report_date then
      raise exception 'report_identity_is_immutable';
    end if;
    new.submitted_at := old.submitted_at;
    if old.status='submitted' and new.status='submitted' then
      raise exception 'reopen_draft_before_correction';
    end if;
    if old.status='draft' and new.status='submitted' then
      perform public.driving_report_validate_submission(new);
      -- Re-submission after correction must keep the very first DB timestamp.
      new.submitted_at:=coalesce(old.submitted_at,v_now);
    end if;
    new.created_at := old.created_at;
    new.created_by_employee_id := old.created_by_employee_id;
    new.employee_name_snapshot := old.employee_name_snapshot;
    new.department_snapshot := old.department_snapshot;
  end if;
  new.updated_at := v_now;
  new.updated_by_employee_id := v_actor;
  -- Never use created_at: a morning draft is not a submission.
  new.late_entry_days := case when new.submitted_at is null then null else
    greatest((new.submitted_at at time zone 'Asia/Tokyo')::date-new.report_date,0) end;
  new.late_entry := new.late_entry_days>0;
  if tg_op='INSERT' or new.vehicle_id is distinct from old.vehicle_id then
    new.vehicle_number_snapshot := null;
    if new.vehicle_id is not null then
      select v.vehicle_number into new.vehicle_number_snapshot from public.vehicles v
        where v.id=new.vehicle_id and v.active;
      if not found then raise exception 'active_vehicle_required'; end if;
    end if;
  else new.vehicle_number_snapshot := old.vehicle_number_snapshot;
  end if;
  if tg_op='INSERT' or new.site_id is distinct from old.site_id then
    new.site_name_snapshot := null;
    if new.site_id is not null then
      select s.display_name into new.site_name_snapshot from public.sites s where s.id=new.site_id;
      if not found then raise exception 'site_not_found'; end if;
    end if;
  else new.site_name_snapshot := old.site_name_snapshot;
  end if;
  if new.status='submitted' and new.driving_status='no_driving' and (
    exists(select 1 from public.driving_report_inspections where driving_report_id=new.id)
    or exists(select 1 from public.driving_alcohol_checks where driving_report_id=new.id)
    or exists(select 1 from public.driving_refuels where driving_report_id=new.id)
  ) then raise exception 'remove_driving_details_before_no_driving'; end if;
  return new;
end;
$$;
create trigger driving_report_prepare before insert or update on public.driving_reports
for each row execute function public.driving_report_prepare();

-- Parent locking also serializes detail insertion with changing to no_driving.
create function public.driving_detail_prepare()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_parent public.driving_reports%rowtype;
begin
  if tg_op='UPDATE' and new.driving_report_id is distinct from old.driving_report_id then
    raise exception 'detail_parent_is_immutable';
  end if;
  select * into v_parent from public.driving_reports
    where id=case when tg_op='DELETE' then old.driving_report_id else new.driving_report_id end for update;
  if not found or v_parent.employee_id is distinct from public.current_employee_id() then
    raise exception 'own_report_required';
  end if;
  if v_parent.status <> 'draft' then raise exception 'reopen_draft_before_correction'; end if;
  if tg_op='DELETE' then return old; end if;
  if v_parent.driving_status <> 'driven' then raise exception 'driven_report_required'; end if;
  if tg_table_name='driving_alcohol_checks' then
    if new.confirmed_by_employee_id is not null then
      if tg_op='UPDATE' and new.confirmed_by_employee_id=old.confirmed_by_employee_id then
        new.confirmed_by_name_snapshot:=old.confirmed_by_name_snapshot;
      else
        select e.name into new.confirmed_by_name_snapshot from public.employees e
          where e.id=new.confirmed_by_employee_id and e.active;
        if not found then raise exception 'active_confirmer_required'; end if;
      end if;
    end if;
  end if;
  return new;
end;
$$;

create function public.driving_vehicle_prepare()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op='INSERT' then new.created_at:=statement_timestamp();
  else new.created_at:=old.created_at; end if;
  new.updated_at:=statement_timestamp();
  return new;
end;
$$;
create trigger driving_vehicle_prepare before insert or update on public.vehicles
for each row execute function public.driving_vehicle_prepare();

alter table public.vehicles enable row level security;
alter table public.driving_reports enable row level security;
create policy vehicles_employee_read on public.vehicles for select to authenticated
using (public.current_employee_id() is not null);
create policy vehicles_admin_insert on public.vehicles for insert to authenticated
with check (public.is_application_admin());
create policy vehicles_admin_update on public.vehicles for update to authenticated
using (public.is_application_admin()) with check (public.is_application_admin());
create policy driving_reports_read on public.driving_reports for select to authenticated
using (employee_id=public.current_employee_id() or public.is_application_admin());
create policy driving_reports_insert on public.driving_reports for insert to authenticated
with check (employee_id=public.current_employee_id());
create policy driving_reports_update on public.driving_reports for update to authenticated
using (employee_id=public.current_employee_id()) with check (employee_id=public.current_employee_id());

do $$
declare t text;
begin
  foreach t in array array['driving_report_inspections','driving_alcohol_checks','driving_refuels'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('create trigger driving_detail_prepare before insert or update or delete on public.%I
      for each row execute function public.driving_detail_prepare()',t);
    execute format('create policy detail_read on public.%I for select to authenticated using (
      exists(select 1 from public.driving_reports r where r.id=driving_report_id
        and (r.employee_id=public.current_employee_id() or public.is_application_admin())))',t);
    execute format('create policy detail_insert on public.%I for insert to authenticated with check (
      exists(select 1 from public.driving_reports r where r.id=driving_report_id
        and r.employee_id=public.current_employee_id()))',t);
    execute format('create policy detail_update on public.%I for update to authenticated using (
      exists(select 1 from public.driving_reports r where r.id=driving_report_id
        and r.employee_id=public.current_employee_id())) with check (
      exists(select 1 from public.driving_reports r where r.id=driving_report_id
        and r.employee_id=public.current_employee_id()))',t);
  end loop;
end;
$$;

revoke all on public.vehicles,public.driving_reports,public.driving_report_inspections,
  public.driving_alcohol_checks,public.driving_refuels from public,anon,authenticated;
grant select,insert,update on public.vehicles,public.driving_reports to authenticated;
grant select,insert,update on public.driving_report_inspections,
  public.driving_alcohol_checks,public.driving_refuels to authenticated;
revoke all on sequence public.vehicles_id_seq,public.driving_reports_id_seq,
  public.driving_alcohol_checks_id_seq,public.driving_refuels_id_seq from public,anon,authenticated;
grant usage on sequence public.vehicles_id_seq,public.driving_reports_id_seq,
  public.driving_alcohol_checks_id_seq,public.driving_refuels_id_seq to authenticated;
revoke all on function public.driving_report_prepare(),public.driving_detail_prepare(),
  public.driving_vehicle_prepare(),
  public.driving_report_validate_submission(public.driving_reports) from public,anon,authenticated;


-- No CSV, notification, application, Auth or existing RLS changes.
commit;
