-- ISOLATED EMPTY TEST DATABASE ONLY. Never run against a shared/production DB.
\set ON_ERROR_STOP on
do $$begin if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated login nosuperuser nobypassrls; end if; end$$;
do $$begin if not exists(select 1 from pg_roles where rolname='anon') then create role anon login nosuperuser nobypassrls; end if; if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role login bypassrls; end if; end$$;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),
    nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid
$$;
grant usage on schema auth to authenticated,anon;
grant execute on function auth.uid() to authenticated,anon;
create table public.employees (
 id bigint primary key, auth_user_id uuid unique, active boolean not null,
 name text not null, department text, admin_scope text
);
create table public.sites (id bigint primary key,display_name text);
-- Exact helper definitions copied from application_management.sql.
create or replace function public.current_employee_id()
returns bigint
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select e.id
  from public.employees e
  where e.auth_user_id = auth.uid()
    and e.active = true
  limit 1
$$;

create or replace function public.is_application_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.employees e
    where e.auth_user_id = auth.uid()
      and e.active = true
      and e.admin_scope = 'all'
  )
$$;


revoke all on function public.current_employee_id(),public.is_application_admin() from public;
grant execute on function public.current_employee_id(),public.is_application_admin() to authenticated;
alter table public.employees enable row level security;
create policy employee_self on public.employees for select to authenticated
using (auth_user_id=auth.uid());
grant select on public.employees to authenticated;
\ir ../supabase/create_driving_report_tables.sql
\ir ../supabase/add_employee_default_vehicle.sql
\ir ../supabase/add_previous_vehicle_end_odometer.sql
insert into public.employees(id,auth_user_id,active,name) values
 (1,'00000000-0000-0000-0000-000000000001',true,'社員A'),
 (2,'00000000-0000-0000-0000-000000000002',true,'社員B'),
 (3,'00000000-0000-0000-0000-000000000003',true,'社員C'),
 (4,'00000000-0000-0000-0000-000000000004',false,'無効社員');
insert into public.vehicles(vehicle_number,vehicle_name)
 select 'TEST-'||n,'車両'||n from generate_series(1,6) n;
update public.employees set default_vehicle_id=1 where id=1;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false);
insert into public.driving_reports(employee_id,report_date,vehicle_id,driving_status,end_odometer)
 select 1,(statement_timestamp() at time zone 'Asia/Tokyo')::date-days,vehicle,'driven',meter
 from (values (10,2,200),(5,6,600),(11,5,500)) x(days,vehicle,meter);
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',false);
insert into public.driving_reports(employee_id,report_date,vehicle_id,driving_status,end_odometer)
 select 2,(statement_timestamp() at time zone 'Asia/Tokyo')::date-days,vehicle,'driven',meter
 from (values (3,1,111),(2,2,222),(4,3,333),(5,6,666),(0,1,999)) x(days,vehicle,meter);
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000003',false);
insert into public.driving_reports(employee_id,report_date,vehicle_id,driving_status,end_odometer)
 values (3,(statement_timestamp() at time zone 'Asia/Tokyo')::date-1,1,'driven',123);
update public.vehicles set active=false where id=5;
-- SQL snapshot for verifying the RPC did not alter any report.
create table public.test_report_snapshot as table public.driving_reports;

-- Storage AUTH/policy behavior is emulated in real PG; actual Storage HTTP is mocked separately.
create schema storage;
create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text);
alter table storage.objects enable row level security;
grant usage on schema storage to authenticated,anon;
grant all on storage.objects to authenticated,anon;
create policy test_existing_broad_policy on storage.objects for all to authenticated using(true) with check(true);
\ir ../supabase/add_driving_report_destination.sql
\ir ../supabase/add_driving_report_submission.sql
\ir ../supabase/add_pre_drive_alcohol_checks.sql
\ir ../supabase/add_fuel_receipts.sql
update public.employees set admin_scope='all' where id=3;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false);
insert into public.driving_refuels(driving_report_id,refueled_at,liters,odometer_km) values(1,'2026-10-10T12:00:00+09:00',10,200);
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',false);
insert into public.driving_refuels(driving_report_id,refueled_at,liters,odometer_km) values(4,'2026-10-14T12:00:00+09:00',20,300);
