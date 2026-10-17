-- Run ONLY on the isolated fixture DB as login role authenticated (not owner).
\set ON_ERROR_STOP on
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}',false);
create function pg_temp.assert_value(label text, actual numeric, expected numeric)
returns void language plpgsql as $$
begin
 if actual is distinct from expected then
  raise exception '%: expected %, got %',label,expected,actual;
 end if;
 raise notice 'PASS % => %',label,coalesce(actual::text,'NULL');
end;
$$;
create function pg_temp.assert_denied(label text, vehicle bigint, report_day date)
returns void language plpgsql as $$
begin
 begin
  perform public.previous_vehicle_end_odometer(vehicle,report_day);
 exception when insufficient_privilege then
  if sqlerrm <> 'vehicle_odometer_access_denied' then raise; end if;
  raise notice 'PASS % => 42501',label;
  return;
 end;
 raise exception '%: access unexpectedly allowed',label;
end;
$$;
do $$
declare
 d date := (statement_timestamp() at time zone 'Asia/Tokyo')::date;
begin
 if session_user <> 'authenticated' or current_user <> 'authenticated'
    or exists(select 1 from pg_roles where rolname=current_user and (rolsuper or rolbypassrls)) then
  raise exception 'test must connect as ordinary authenticated login';
 end if;
 raise notice 'PASS ordinary authenticated connection (no SUPERUSER / BYPASSRLS)';
 if (select count(*) from public.driving_reports) <> 3
    or exists(select 1 from public.driving_reports where employee_id<>1) then
  raise exception 'RLS leaked another employee report';
 end if;
 raise notice 'PASS RLS hides other employee report IDs, names and details';
 perform pg_temp.assert_value('default vehicle / other employee latest value',public.previous_vehicle_end_odometer(1,d),123);
 perform pg_temp.assert_value('previously used vehicle / other employee latest value',public.previous_vehicle_end_odometer(2,d),222);
 perform pg_temp.assert_denied('only other employees used vehicle',3,d);
 perform pg_temp.assert_denied('unused different vehicle',4,d);
 perform pg_temp.assert_value('switch back to vehicle 1',public.previous_vehicle_end_odometer(1,d),123);
 perform pg_temp.assert_value('switch to vehicle 2',public.previous_vehicle_end_odometer(2,d),222);
 perform pg_temp.assert_value('report date cutoff excludes newer and same-day records',public.previous_vehicle_end_odometer(1,d-2),111);
 perform pg_temp.assert_value('no earlier record',public.previous_vehicle_end_odometer(1,d-20),null);
 perform pg_temp.assert_value('inactive vehicle',public.previous_vehicle_end_odometer(5,d),null);
 perform pg_temp.assert_value('nonexistent vehicle',public.previous_vehicle_end_odometer(999,d),null);
 perform pg_temp.assert_value('null vehicle',public.previous_vehicle_end_odometer(null,d),null);
 perform pg_temp.assert_value('conflicting values on most recent day',public.previous_vehicle_end_odometer(6,d),null);
 -- A later own report must not grant access for an earlier report date.
 perform pg_temp.assert_denied('own use is later than requested date',2,d-11);
 begin
  perform public.previous_vehicle_end_odometer(1,d+1);
  raise exception 'future date unexpectedly accepted';
 exception when raise_exception then
  if sqlerrm <> 'invalid_report_date' then raise; end if;
  raise notice 'PASS future date => invalid_report_date';
 end;
 begin
  perform public.previous_vehicle_end_odometer(1,null);
  raise exception 'null date unexpectedly accepted';
 exception when raise_exception then
  if sqlerrm <> 'invalid_report_date' then raise; end if;
  raise notice 'PASS null date => invalid_report_date';
 end;
 if (select prorettype from pg_proc where oid='public.previous_vehicle_end_odometer(bigint,date)'::regprocedure) <> 'numeric'::regtype
   or not (select prosecdef and proconfig @> array['search_path=""'] from pg_proc
     where oid='public.previous_vehicle_end_odometer(bigint,date)'::regprocedure) then
  raise exception 'unexpected function security configuration';
 end if;
 raise notice 'PASS numeric-only result / SECURITY DEFINER / empty search_path';
 if has_function_privilege('anon','public.previous_vehicle_end_odometer(bigint,date)','execute') then
  raise exception 'anonymous execute is allowed';
 end if;
 raise notice 'PASS anon has no RPC EXECUTE grant';
end;
$$;
-- Shadow objects must not alter either authorization or the returned value.
create temp table employees(id bigint,auth_user_id uuid,active boolean,default_vehicle_id bigint);
insert into employees values (1,'00000000-0000-0000-0000-000000000001',true,3);
create temp table driving_reports(vehicle_id bigint,report_date date,end_odometer numeric,driving_status text,employee_id bigint);
insert into driving_reports values (1,current_date-1,7777,'driven',1),(3,current_date-1,8888,'driven',1);
set search_path=pg_temp,public;
select pg_temp.assert_value('temporary table shadowing cannot replace value',public.previous_vehicle_end_odometer(1,(statement_timestamp() at time zone 'Asia/Tokyo')::date),123);
select pg_temp.assert_denied('temporary table shadowing cannot grant permission',3,(statement_timestamp() at time zone 'Asia/Tokyo')::date);
-- Claim without any matching active employee must fail even under authenticated role.
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000004"}',false);
do $$ begin
 begin
  perform public.previous_vehicle_end_odometer(1,(statement_timestamp() at time zone 'Asia/Tokyo')::date);
  raise exception 'inactive employee unexpectedly accepted';
 exception when raise_exception then
  if sqlerrm <> 'active_employee_required' then raise; end if;
  raise notice 'PASS inactive employee => active_employee_required';
 end;
end $$;
select set_config('request.jwt.claims','{}',false);
do $$ begin
 begin
  perform public.previous_vehicle_end_odometer(1,(statement_timestamp() at time zone 'Asia/Tokyo')::date);
  raise exception 'missing JWT unexpectedly accepted';
 exception when raise_exception then
  if sqlerrm <> 'active_employee_required' then raise; end if;
  raise notice 'PASS authenticated role without JWT => active_employee_required';
 end;
end $$;
