-- PREPARATION ONLY. Requires reviewed holiday fix, pre-drive validation, target column.
-- Exact installed prosrc hashes prevent silently replacing a different business rule.
-- Reformatting in production intentionally requires review; never bypass this guard.
-- Reviewed production CRLF validator: identical to LF body, no business changes.
begin;
do $$
begin
 if not exists(select 1 from pg_catalog.pg_proc where oid=pg_catalog.to_regprocedure('public.check_driving_report_month(date)')
   and proowner=(select oid from pg_catalog.pg_roles where rolname=current_user) and prosecdef
   and md5(prosrc) in ('6cdc45d26f86174e42115a978e9b87d8','e09eab0ee2f25b53d23fc9cb56d7c2b8'))
 or not exists(select 1 from pg_catalog.pg_proc where oid=pg_catalog.to_regprocedure('public.driving_report_validate_submission(public.driving_reports)')
   and proowner=(select oid from pg_catalog.pg_roles where rolname=current_user) and not prosecdef
   and md5(prosrc) in ('51783e04d16b39c9bc2f63732b56ab5a','8d06f197a323fc46ad28e716a62335b6','7afb098408f2812b1ecd79fa929a0814')) then raise exception 'driving_month_definition_requires_review'; end if;
 if not exists(select 1 from pg_catalog.pg_attribute where attrelid='public.employees'::regclass
   and attname='driving_report_required' and atttypid='boolean'::regtype and attnotnull) then raise exception 'driving_target_column_required'; end if;
end;
$$;
do $$
begin
 if pg_catalog.to_regprocedure('public.driving_report_validate_fields_internal(public.driving_reports)') is not null and not exists(select 1 from pg_catalog.pg_proc where oid=pg_catalog.to_regprocedure('public.driving_report_validate_fields_internal(public.driving_reports)') and proowner=(select oid from pg_catalog.pg_roles where rolname=current_user) and md5(prosrc)='fdf01536c7ee6a14bde18f953d16b260') then raise exception 'driving_admin_function_collision'; end if;
 if pg_catalog.to_regprocedure('public.driving_check_month_internal(bigint,date)') is not null and not exists(select 1 from pg_catalog.pg_proc where oid=pg_catalog.to_regprocedure('public.driving_check_month_internal(bigint,date)') and proowner=(select oid from pg_catalog.pg_roles where rolname=current_user) and md5(prosrc)='cad6d182172aeccee2001c5bb531f7f1') then raise exception 'driving_admin_function_collision'; end if;
 if pg_catalog.to_regprocedure('public.driving_month_admin_guard(date)') is not null and not exists(select 1 from pg_catalog.pg_proc where oid=pg_catalog.to_regprocedure('public.driving_month_admin_guard(date)') and proowner=(select oid from pg_catalog.pg_roles where rolname=current_user) and md5(prosrc)='2e278d7af3f103d4553c89cfb7bc6d36') then raise exception 'driving_admin_function_collision'; end if;
 if pg_catalog.to_regprocedure('public.driving_month_day_kind_internal(jsonb,date,boolean)') is not null and not exists(select 1 from pg_catalog.pg_proc where oid=pg_catalog.to_regprocedure('public.driving_month_day_kind_internal(jsonb,date,boolean)') and proowner=(select oid from pg_catalog.pg_roles where rolname=current_user) and md5(prosrc)='9fa41149ecaeb7c963ad31a34c9ac106') then raise exception 'driving_admin_function_collision'; end if;
 if pg_catalog.to_regprocedure('public.admin_driving_month_status(date,integer,integer)') is not null and not exists(select 1 from pg_catalog.pg_proc where oid=pg_catalog.to_regprocedure('public.admin_driving_month_status(date,integer,integer)') and proowner=(select oid from pg_catalog.pg_roles where rolname=current_user) and md5(prosrc)='f92536443c425a75af3be83fa2bc2e96') then raise exception 'driving_admin_function_collision'; end if;
 if pg_catalog.to_regprocedure('public.admin_driving_month_days(bigint,date)') is not null and not exists(select 1 from pg_catalog.pg_proc where oid=pg_catalog.to_regprocedure('public.admin_driving_month_days(bigint,date)') and proowner=(select oid from pg_catalog.pg_roles where rolname=current_user) and md5(prosrc)='283b5d855aaed4c47a84cf701f4f9d51') then raise exception 'driving_admin_function_collision'; end if;
end;
$$;
create or replace function public.driving_report_validate_fields_internal(p_report public.driving_reports)
returns void language plpgsql set search_path='' as $$
begin

  if p_report.driving_status='no_driving' then
    -- A formal no-driving submission, not a missing report or zero-km drive.
    if p_report.vehicle_id is not null or p_report.outbound_route_type is not null
      or p_report.return_route_type is not null
      or p_report.route_note is not null or p_report.site_id is not null
      or p_report.destination_text is not null
      or p_report.site_name_snapshot is not null
      or p_report.start_odometer is not null or p_report.end_odometer is not null
      or p_report.accident_or_violation or p_report.accident_violation_note is not null
      or exists(select 1 from public.driving_report_inspections where driving_report_id=p_report.id)
      or exists(select 1 from public.driving_alcohol_checks where driving_report_id=p_report.id)
      or exists(select 1 from public.driving_refuels where driving_report_id=p_report.id) then
      raise exception 'no_driving_must_not_have_driving_data';
    end if;
    return;
  end if;

  if p_report.driving_status is distinct from 'driven' then
    raise exception 'invalid_driving_status';
  end if;
  if p_report.vehicle_id is null or p_report.outbound_route_type is null
    or p_report.return_route_type is null
    or p_report.start_odometer is null or p_report.end_odometer is null then
    raise exception 'driving_submission_fields_required';
  end if;
  if p_report.end_odometer < p_report.start_odometer then
    raise exception 'end_odometer_before_start';
  end if;
  if p_report.accident_or_violation
    and nullif(btrim(p_report.accident_violation_note),'') is null then
    raise exception 'accident_violation_note_required';
  end if;

  -- Exact set equality, not merely 13 arbitrary rows. The existing composite PK
  -- also prevents duplicates. Recheck count/distinct and results at submission.
  if (select count(*) from public.driving_report_inspections where driving_report_id=p_report.id)<>13
    or (select count(distinct inspection_item_code) from public.driving_report_inspections
        where driving_report_id=p_report.id)<>13
    or exists (
      select 1 from public.driving_report_inspection_items() required
      where not exists (
        select 1 from public.driving_report_inspections i
        where i.driving_report_id=p_report.id
          and i.inspection_item_code=required.inspection_item_code))
    or exists (
      select 1 from public.driving_report_inspections i
      where i.driving_report_id=p_report.id and (
        not exists (select 1 from public.driving_report_inspection_items() required
          where required.inspection_item_code=i.inspection_item_code)
        or i.result is null or i.result not in ('ok','defect','not_applicable')
        or (i.result='defect' and nullif(btrim(i.note),'') is null))) then
    raise exception 'all_13_official_inspections_required';
  end if;

  if p_report.alcohol_check_version=1 then
    if (select count(*) from public.driving_alcohol_checks where driving_report_id=p_report.id and check_type='before')<>1
      or (select count(*) from public.driving_alcohol_checks where driving_report_id=p_report.id and check_type='after')<>1 then
      raise exception 'before_and_after_alcohol_checks_required';
    end if;
  else
    if (select count(*) from public.driving_alcohol_checks where driving_report_id=p_report.id
      and check_type in ('commute_before','return_before') and checked_at is not null and alcohol_value is not null
      and phone_confirmed is not null and confirmed_by_name_snapshot in ('中尾','安藤'))<>2 then
      raise exception 'both_pre_drive_alcohol_checks_required';
    end if;
  end if;
end;
$$;
create or replace function public.driving_report_validate_submission(p_report public.driving_reports)
returns void language plpgsql set search_path='' as $$
begin
  if p_report.employee_id is distinct from public.current_employee_id() then
    raise exception 'own_report_required';
  end if;
  perform public.driving_report_validate_fields_internal(p_report);
end;
$$;
create or replace function public.driving_check_month_internal(p_employee_id bigint,p_closing_month date)
returns jsonb language plpgsql stable security definer set search_path='' set row_security=off as $$
declare
 actor bigint:=p_employee_id; start_date date; end_date date;
 d date; r public.driving_reports%rowtype; a public.attendance%rowtype;
 n integer; hn integer; ht text; leaves integer; full_leaves integer; half_leaves integer; hw integer; leave_app bigint; leave_kind text;
 required boolean; reason text; issue text; days jsonb:='[]'; errors jsonb:='[]';
begin
 if actor is null or not exists(select 1 from public.employees where id=actor) then raise exception 'employee_required'; end if;
 if p_closing_month is null or extract(day from p_closing_month)<>1
  or p_closing_month<date '1001-01-01' or p_closing_month>date '9998-12-01' then raise exception 'invalid_closing_month'; end if;
 start_date:=(p_closing_month-interval '1 month'+interval '20 days')::date;
 end_date:=p_closing_month+19;
 for d in select generate_series(start_date,end_date,interval '1 day')::date loop
  required:=false; issue:=null; reason:=null;
  select * into r from public.driving_reports where employee_id=actor and report_date=d;
  select count(*),min(day_type) into hn,ht from public.holidays where date=d;
  select count(*) into n from public.attendance where employee_id=actor and work_date=d;
  select * into a from public.attendance where employee_id=actor and work_date=d limit 1;
  -- Approved full paid leave must have an unambiguous day or its synced row.
  select count(*),count(*) filter(where q.full_day),count(*) filter(where q.half_day),min(q.aid) filter(where q.full_day),min(q.kind) filter(where q.full_day) into leaves,full_leaves,half_leaves,leave_app,leave_kind from (
   select (pd.day_part='full' and pd.days=trunc(pd.days) and
    ((pd.start_date=d and pd.end_date=d and pd.days=1) or exists(
     select 1 from public.attendance x where x.employee_id=actor and x.work_date=d
      and x.source_type='application' and x.source_application_id=ap.id and x.site_type='休み' and x.leave_type='有給'))) full_day,(pd.day_part in ('am','pm') and pd.days=0.5 and pd.start_date=pd.end_date) half_day,ap.id aid,'有給'::text kind
   from public.applications ap join public.paid_leave_application_details pd on pd.application_id=ap.id
   where ap.employee_id=actor and ap.status='approved' and ap.application_type='paid_leave' and d between pd.start_date and pd.end_date
    and not (pd.day_part='full' and hn=1 and ht in ('休日','祝日'))
   union all
   select cd.days=1,cd.days=0.5,ap.id,'代休'::text from public.applications ap join public.comp_leave_dates cd on cd.application_id=ap.id
   where ap.employee_id=actor and ap.status='approved' and ap.application_type='comp_leave' and cd.leave_date=d and not cd.admin_direct
  ) q;
  select count(*) into hw from public.holiday_work_records where employee_id=actor and work_date=d and status='active';
  if n>1 or leaves>1 then issue:='work_leave_conflict';
  elsif leaves=1 then
   if full_leaves<>1 then
    if half_leaves=1 and (hw>0 or (n=1 and a.status in ('submitted','locked') and a.site_type in ('会社勤務','一般','雑工事'))) then
     if n=1 and (a.site_type not in ('会社勤務','一般','雑工事') or a.site_type is null or a.status not in ('submitted','locked') or a.status is null) then issue:='work_leave_conflict';
     else required:=true; reason:='half_leave_work'; end if;
    else issue:='half_or_ambiguous_leave'; end if;
   elsif hw>0 or (n=1 and (a.site_type is distinct from '休み' or a.leave_type is distinct from leave_kind or (a.source_application_id is not null and a.source_application_id is distinct from leave_app))) then issue:='work_leave_conflict';
   else reason:='approved_full_leave'; end if;
  elsif hw>0 then
   if n=1 and (a.status not in ('submitted','locked') or a.status is null or a.site_type not in ('会社勤務','一般','雑工事') or a.site_type is null) then issue:='holiday_work_attendance_conflict';
   else required:=true; reason:='active_holiday_work'; end if;
  -- A saved calendar holiday is not unfinished work. Require an exact
  -- calendar/rest match and no work/leave linkage or work fields; never
  -- exempt a working draft, an unknown leave, or a holiday-work conflict.
  elsif n=1 and hn=1 and ht in ('休日','祝日')
   and a.site_type='休み' and a.leave_type='休日'
   and a.status in ('draft','submitted','locked')
   and a.source_application_id is null and coalesce(a.source_type,'') in ('','manual')
   and a.site_id is null
   and nullif(btrim(concat(a.misc_company,a.misc_department,a.company_work,a.misc_name,a.start_time,a.end_time,a.note)),'') is null
   then reason:='company_holiday';
  elsif n=1 then
   if a.status in ('submitted','locked') and a.site_type in ('会社勤務','一般','雑工事') then required:=true; reason:='confirmed_work';
   else issue:='work_unconfirmed'; end if;
  elsif hn=1 and ht in ('休日','祝日') then reason:='company_holiday';
  elsif hn=1 and ht in ('出勤','有給奨励日') then required:=true; reason:='calendar_workday';
  else issue:='calendar_unconfirmed'; end if;
  -- An existing holiday report must never silently disappear from submission.
  if r.id is not null then required:=true; end if;
  if issue is null and required and r.id is null then issue:='report_missing'; end if;
  if issue is null and r.id is not null and r.status='draft' then
   begin
    perform public.driving_report_validate_fields_internal(r);
   exception when others then issue:=sqlerrm; end;
  end if;
  if issue is null and r.id is not null and exists(
   select 1 from public.fuel_receipts where report_id=r.id and state in ('pending','deleting')
  ) then issue:='receipt_upload_pending'; end if;
  days:=days||jsonb_build_array(jsonb_build_object('date',d,'calendar',ht,'required',required,'reason',reason,
   'report_id',r.id,'status',r.status,'issue',issue,
   'attendance',case when n=1 then jsonb_build_object('id',a.id,'status',a.status,'site_type',a.site_type,
    'leave_type',a.leave_type,'source_application_id',a.source_application_id) else null end,
   'leave_application_id',leave_app,
   'holiday_work_record_ids',(select coalesce(jsonb_agg(h.id order by h.id),'[]') from public.holiday_work_records h
    where h.employee_id=actor and h.work_date=d and h.status='active')));
  if issue is not null then errors:=errors||jsonb_build_array(jsonb_build_object('date',d,'code',issue)); end if;
 end loop;
 return jsonb_build_object('closing_month',p_closing_month,'period_start',start_date,'period_end',end_date,
  'eligible',(statement_timestamp() at time zone 'Asia/Tokyo')::date>=end_date+1,
  'already_submitted',exists(select 1 from public.driving_report_month_submissions where employee_id=actor and closing_month=p_closing_month),
  'valid',jsonb_array_length(errors)=0,'days',days,'errors',errors);
end $$;
create or replace function public.check_driving_report_month(p_closing_month date)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if public.current_employee_id() is null or auth.uid() is null then raise exception 'active_employee_required' using errcode='42501'; end if;
 return public.driving_check_month_internal(public.current_employee_id(),p_closing_month);
end;
$$;
-- Keep existing wrapper ACLs and owners; all new internals are private.
revoke all on function public.driving_report_validate_fields_internal(public.driving_reports),public.driving_check_month_internal(bigint,date)
 from public,anon,authenticated,service_role;

create or replace function public.driving_month_admin_guard(p_month date)
returns bigint language plpgsql stable security definer set search_path='' set row_security=off as $$
declare actor bigint;
begin
 if auth.uid() is null or not coalesce(public.is_application_admin(),false)
   or (select count(*) from public.employees where auth_user_id=auth.uid())<>1
 then raise exception 'admin_required' using errcode='42501'; end if;
 actor:=public.current_employee_id();
 if actor is null then raise exception 'admin_required' using errcode='42501'; end if;
 if p_month is null or extract(day from p_month)<>1 or p_month<date '1001-01-01' or p_month>date '9998-12-01' then raise exception 'invalid_closing_month'; end if;
 -- Fail on incomplete owner privileges/RLS; do not report hidden rows as zero.
 perform e.* from public.employees e limit 0;
 perform r.* from public.driving_reports r limit 0;
 perform h.* from public.holidays h limit 0;
 perform a.* from public.attendance a limit 0;
 perform a.* from public.applications a limit 0;
 perform d.* from public.paid_leave_application_details d limit 0;
 perform d.* from public.comp_leave_dates d limit 0;
 perform h.* from public.holiday_work_records h limit 0;
 perform i.* from public.driving_report_inspections i limit 0;
 perform a.* from public.driving_alcohol_checks a limit 0;
 perform f.* from public.driving_refuels f limit 0;
 perform f.* from public.fuel_receipts f limit 0;
 perform m.* from public.driving_report_month_submissions m limit 0;
 return actor;
end;
$$;

create or replace function public.driving_month_day_kind_internal(d jsonb,today date,submitted boolean)
returns text language sql immutable set search_path='' as $$
 select case
 when (d->>'date')::date>today then 'future'
 when submitted then 'complete'
 when (d->>'date')::date=today then case when d->>'status'='submitted' then 'complete' else 'today' end
 when d->>'issue'='report_missing' and d->>'report_id' is null then 'missing'
 when d->>'issue' in ('receipt_upload_pending','driving_submission_fields_required','all_13_official_inspections_required',
   'both_pre_drive_alcohol_checks_required','end_odometer_before_start','accident_violation_note_required',
   'before_and_after_alcohol_checks_required','no_driving_must_not_have_driving_data','invalid_driving_status') then 'incomplete'
 when d->>'issue' is not null then 'review'
 when d->>'status'='submitted' then 'complete'
 when (d->>'required')::boolean=false and d->>'reason' in ('company_holiday','approved_full_leave') then 'exempt'
 when (d->>'required')::boolean=true and d->>'report_id' is not null then 'ready'
 when (d->>'required')::boolean=true then 'missing'
 else 'review' end;
$$;

create or replace function public.admin_driving_month_status(p_closing_month date,p_limit integer default 50,p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path='' set row_security=off as $$
declare actor bigint;
begin
 actor:=public.driving_month_admin_guard(p_closing_month);
 if p_limit is null or p_limit<1 or p_limit>100 or p_offset is null or p_offset<0 then raise exception 'invalid_page'; end if;
 return (with roster as materialized (
   select e.id,e.name,e.department,e.active from public.employees e where e.driving_report_required order by e.id limit p_limit offset p_offset
 ), checked as materialized (
   select e.*,public.driving_check_month_internal(e.id,p_closing_month) c from roster e
 ), summary as (
   select c.id,c.name,c.department,c.active,
     (c.c->>'already_submitted')::boolean as submitted,
     (select m.submitted_at from public.driving_report_month_submissions m where m.employee_id=c.id and m.closing_month=p_closing_month) submitted_at,
     (select count(*) from jsonb_array_elements(c.c->'days') d where public.driving_month_day_kind_internal(d,(statement_timestamp() at time zone 'Asia/Tokyo')::date,(c.c->>'already_submitted')::boolean)='missing') missing,
     (select count(*) from jsonb_array_elements(c.c->'days') d where public.driving_month_day_kind_internal(d,(statement_timestamp() at time zone 'Asia/Tokyo')::date,(c.c->>'already_submitted')::boolean)='incomplete') incomplete,
     (select count(*) from jsonb_array_elements(c.c->'days') d where public.driving_month_day_kind_internal(d,(statement_timestamp() at time zone 'Asia/Tokyo')::date,(c.c->>'already_submitted')::boolean)='review') review
   from checked c
 ) select jsonb_build_object('closing_month',p_closing_month,
   'period_start',(p_closing_month-interval '1 month'+interval '20 days')::date,'period_end',p_closing_month+19,
   'actor_id',actor,'total',(select count(*) from public.employees where driving_report_required),
   'roster_token',(select md5(coalesce(jsonb_agg(jsonb_build_array(e.id,e.name,e.department,e.active) order by e.id)::text,'[]')) from public.employees e where e.driving_report_required),
   'employees',coalesce((select jsonb_agg(to_jsonb(s) order by s.id) from summary s),'[]'::jsonb)));
end;
$$;

create or replace function public.admin_driving_month_days(p_employee_id bigint,p_closing_month date)
returns jsonb language plpgsql stable security definer set search_path='' set row_security=off as $$
declare c jsonb; e public.employees; timestamp_value timestamptz;
begin
 perform public.driving_month_admin_guard(p_closing_month);
 select * into e from public.employees where id=p_employee_id;
 if not found then raise exception 'employee_not_found'; end if;
 -- Read-only access includes the administrator's own and non-target employees.
 c:=public.driving_check_month_internal(e.id,p_closing_month);
 select submitted_at into timestamp_value from public.driving_report_month_submissions where employee_id=e.id and closing_month=p_closing_month;
 return jsonb_build_object('employee',jsonb_build_object('id',e.id,'name',e.name,'department',e.department,'active',e.active,'driving_report_required',e.driving_report_required),
   'closing_month',p_closing_month,'period_start',c->'period_start','period_end',c->'period_end',
   'submitted',c->'already_submitted','submitted_at',timestamp_value,
   'days',(select jsonb_agg(jsonb_build_object('date',d->'date','status',d->'status','required',d->'required',
     'reason',d->'reason','issue',d->'issue','report_id',d->'report_id',
     'kind',public.driving_month_day_kind_internal(d,(statement_timestamp() at time zone 'Asia/Tokyo')::date,(c->>'already_submitted')::boolean)) order by d->>'date')
     from jsonb_array_elements(c->'days') d));
end;
$$;
revoke all on function public.driving_month_admin_guard(date),public.driving_month_day_kind_internal(jsonb,date,boolean),
 public.admin_driving_month_status(date,integer,integer),public.admin_driving_month_days(bigint,date) from public,anon,authenticated,service_role;
-- Remove inherited/default custom-role grants on NEW functions too. Never
-- apply this to existing check/validation wrappers whose ACLs must be preserved.
do $$
declare f record; a record;
begin
 for f in select oid,proowner,proacl from pg_catalog.pg_proc where oid in (
  'public.driving_report_validate_fields_internal(public.driving_reports)'::regprocedure,
  'public.driving_check_month_internal(bigint,date)'::regprocedure,
  'public.driving_month_admin_guard(date)'::regprocedure,
  'public.driving_month_day_kind_internal(jsonb,date,boolean)'::regprocedure,
  'public.admin_driving_month_status(date,integer,integer)'::regprocedure,
  'public.admin_driving_month_days(bigint,date)'::regprocedure) loop
  for a in select distinct grantee from pg_catalog.aclexplode(f.proacl) where grantee<>0 and grantee<>f.proowner loop
   execute format('revoke all on function %s from %I',f.oid::regprocedure,pg_catalog.pg_get_userbyid(a.grantee));
  end loop;
 end loop;
end;
$$;
-- The existing validator is SECURITY INVOKER and retains service_role EXECUTE.
-- Its field-only helper must therefore be callable by that trusted role too.
-- Grant AFTER default/custom ACL cleanup so repeat installation preserves it.
-- No access to the employee/month cores or admin entry points is added.
grant execute on function public.driving_report_validate_fields_internal(public.driving_reports) to service_role;
grant execute on function public.admin_driving_month_status(date,integer,integer),public.admin_driving_month_days(bigint,date) to authenticated;
notify pgrst,'reload schema';
commit;
