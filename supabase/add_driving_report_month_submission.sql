-- PREPARATION ONLY. No production execution. Apply as DB owner after driving
-- submission/destination/pre-drive-alcohol, fuel receipts and attendance sync.
-- Additive migration: no existing report/status/timestamp is backfilled.
begin;
create table public.driving_report_month_submissions (
 id bigint generated always as identity primary key,
 employee_id bigint not null references public.employees(id),
 closing_month date not null check(extract(day from closing_month)=1),
 period_start date not null, period_end date not null,
 submitted_at timestamptz not null default clock_timestamp(),
 submitted_by bigint not null references public.employees(id),
 rule_version integer not null default 1 check(rule_version=1),
 snapshot jsonb not null,
 unique(employee_id,closing_month),
 check(submitted_by=employee_id),
 check(period_start=(closing_month-interval '1 month'+interval '20 days')::date),
 check(period_end=closing_month+20-1)
);
alter table public.driving_report_month_submissions enable row level security;
create policy driving_month_read on public.driving_report_month_submissions
 for select to authenticated using(employee_id=public.current_employee_id() or public.is_application_admin());
revoke all on public.driving_report_month_submissions from public,anon,authenticated,service_role;
revoke all on sequence public.driving_report_month_submissions_id_seq from public,anon,authenticated,service_role;
grant select on public.driving_report_month_submissions to authenticated;

-- Per employee/closing-month rows. No application role may change these rows.
create table public.driving_report_month_gates (
 employee_id bigint not null references public.employees(id), closing_month date not null,
 primary key(employee_id,closing_month), check(extract(day from closing_month)=1)
);
alter table public.driving_report_month_gates enable row level security;
revoke all on public.driving_report_month_gates from public,anon,authenticated,service_role;
create function public.driving_closing_month(d date) returns date
language sql immutable set search_path='' as $$
 select (date_trunc('month',d::timestamp)::date+case when extract(day from d)>=21 then interval '1 month' else interval '0' end)::date
$$;
-- Advisory bootstrap covers the not-yet-existing gate row. The row is the durable
-- identity; hash collisions can only cause conservative contention, never bypass.
-- RPCs take this BEFORE parent/detail locks. Direct REST/source row triggers use
-- NOWAIT because PostgreSQL may already hold the target row: never wait in reverse order.
create function public.driving_month_lock(e bigint,m date,fail_fast boolean default true) returns void
language plpgsql security definer set search_path='' as $$
declare k bigint:=pg_catalog.hashtextextended('driving-month:'||e||':'||to_char(m,'YYYY-MM-DD'),0);
begin
 if e is null or m is null then raise exception 'invalid_month_gate'; end if;
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'read_committed_required'; end if;
 if fail_fast then
  if not pg_catalog.pg_try_advisory_xact_lock(k) then raise exception 'driving_month_busy_retry' using errcode='55P03'; end if;
 else perform pg_catalog.pg_advisory_xact_lock(k); end if;
 insert into public.driving_report_month_gates values(e,m) on conflict do nothing;
 perform 1 from public.driving_report_month_gates where employee_id=e and closing_month=m for update nowait;
end $$;
create function public.driving_calendar_lock(m date,writer boolean) returns void
language plpgsql security definer set search_path='' as $$
declare k bigint:=pg_catalog.hashtextextended('driving-calendar:'||to_char(m,'YYYY-MM-DD'),0);
begin
 if writer then
  if not pg_catalog.pg_try_advisory_xact_lock(k) then raise exception 'driving_calendar_busy_retry' using errcode='55P03'; end if;
 else
  if not pg_catalog.pg_try_advisory_xact_lock_shared(k) then raise exception 'driving_calendar_busy_retry' using errcode='55P03'; end if;
 end if;
end $$;
create function public.driving_month_edit_guard() returns trigger
language plpgsql security definer set search_path='' as $$
declare e bigint; d date;
begin
 if tg_table_name='driving_reports' then
  if tg_op='DELETE' then e:=old.employee_id; d:=old.report_date;
  else e:=new.employee_id; d:=new.report_date; end if;
 else
  select employee_id,report_date into e,d from public.driving_reports
   where id=case when tg_op='DELETE' then old.driving_report_id else new.driving_report_id end;
 end if;
 if e is null then raise exception 'report_not_found'; end if;
 perform public.driving_month_lock(e,public.driving_closing_month(d),true);
 if exists(select 1 from public.driving_report_month_submissions s where s.employee_id=e
   and d between s.period_start and s.period_end) then
  raise exception 'driving_month_already_submitted' using errcode='42501';
 end if;
 if tg_op='DELETE' then return old; else return new; end if;
end $$;
do $$declare t text; begin
 foreach t in array array['driving_reports','driving_report_inspections','driving_alcohol_checks','driving_refuels'] loop
  execute format('create trigger a_driving_month_guard before insert or update or delete on public.%I for each row execute function public.driving_month_edit_guard()',t);
 end loop;
end $$;
-- Trusted cascade context: the parent BEFORE DELETE captures ownership and
-- locks ALL affected months before the parent becomes invisible to FK actions.
-- No GUC, client payload or NULL-owner bypass can supply this evidence.
create table public.driving_month_application_deletions (
 transaction_id xid8 not null, application_id bigint not null,
 employee_id bigint not null, closing_months date[] not null,
 primary key(transaction_id,application_id)
);
alter table public.driving_month_application_deletions enable row level security;
revoke all on public.driving_month_application_deletions from public,anon,authenticated,service_role;
create function public.driving_month_deletion_cleanup() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 -- Statement-level cleanup on EVERY cascade level. Checking the complete graph
 -- avoids reliance on FK trigger ordering or SET CONSTRAINTS timing.
 delete from public.driving_month_application_deletions c
 where c.transaction_id=pg_catalog.pg_current_xact_id()
  and not exists(select 1 from public.applications a where a.id=c.application_id)
  and not exists(select 1 from public.paid_leave_application_details p where p.application_id=c.application_id)
  and not exists(select 1 from public.comp_leave_application_details p where p.application_id=c.application_id)
  and not exists(select 1 from public.comp_leave_dates p where p.application_id=c.application_id);
 return null;
end $$;
do $$declare t text;begin
 foreach t in array array['applications','paid_leave_application_details','comp_leave_application_details','comp_leave_dates'] loop
  execute format('create trigger z_driving_month_deletion_cleanup after delete on public.%I for each statement execute function public.driving_month_deletion_cleanup()',t);
 end loop;
end $$;
-- Admin direct usage is a balance ledger (arbitrary decimal days), not evidence
-- of a day off. Only an existing, consistently marked, unsynchronized ledger
-- may be maintained independently of driving-month closure.
create function public.driving_month_balance_application(aid bigint) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.applications a where a.id=aid and a.application_type='comp_leave'
  and starts_with(coalesce(a.reviewer_comment,''),'admin_comp_usage:')
  and exists(select 1 from public.comp_leave_dates d where d.application_id=a.id and d.admin_direct)
  and not exists(select 1 from public.comp_leave_dates d where d.application_id=a.id and not d.admin_direct)
  and not exists(select 1 from public.attendance t where t.source_application_id=a.id))
$$;
-- All read sources participate, including INSERT, DELETE, date/owner moves and
-- approval/cancellation. Application changes touching a submitted month are
-- rejected; non-application sources keep their existing historical-snapshot policy. A source writer never waits while holding source-row locks.
create function public.driving_month_source_guard() returns trigger
language plpgsql security definer set search_path='' as $$
declare j jsonb; e bigint; aid bigint; first_day date; last_day date; key record;
 keys jsonb:='[]'; cascade_months date[];
begin
 -- Compare every business column, not just status. Existing GRANT/RPC admin
 -- checks still control who can set print metadata; no permission is added.
 if tg_table_name='applications' and tg_op='UPDATE' and
  (to_jsonb(new)-array['printed_at','printed_by_employee_id','updated_at','updated_by_employee_id'])=
  (to_jsonb(old)-array['printed_at','printed_by_employee_id','updated_at','updated_by_employee_id']) then
  return new;
 end if;
 for j in select v from (values(case when tg_op<>'INSERT' then to_jsonb(old) end),
  (case when tg_op<>'DELETE' then to_jsonb(new) end)) x(v) where v is not null loop
  if tg_table_name='holidays' then
   keys:=keys||jsonb_build_array(jsonb_build_object('e',0,'m',public.driving_closing_month((j->>'date')::date)));
  elsif tg_table_name in ('attendance','holiday_work_records') then
   keys:=keys||jsonb_build_array(jsonb_build_object('e',(j->>'employee_id')::bigint,'m',public.driving_closing_month((j->>'work_date')::date)));
  else
   aid:=case when tg_table_name='applications' then (j->>'id')::bigint else (j->>'application_id')::bigint end;
   if tg_table_name='applications' then e:=(j->>'employee_id')::bigint;
   else
    select employee_id into e from public.applications where id=aid;
    if not found then
     if tg_op<>'DELETE' then raise exception 'application_owner_not_found'; end if;
     select employee_id,closing_months into e,cascade_months
      from public.driving_month_application_deletions
      where transaction_id=pg_catalog.pg_current_xact_id() and application_id=aid;
     if not found then raise exception 'application_cascade_context_required' using errcode='42501'; end if;
     select keys||coalesce(jsonb_agg(jsonb_build_object('e',e,'m',m)),'[]') into keys from unnest(cascade_months) m;
     continue;
    end if;
   end if;
   if tg_table_name='applications' and public.driving_month_balance_application(aid)
    and (j->>'application_type')='comp_leave'
    and starts_with(coalesce(j->>'reviewer_comment',''),'admin_comp_usage:')
    and (tg_op<>'UPDATE' or j->>'employee_id'=to_jsonb(old)->>'employee_id') then continue; end if;
   if tg_table_name='comp_leave_application_details' and public.driving_month_balance_application(aid) then continue; end if;
   if tg_table_name='comp_leave_dates' and (j->>'admin_direct')::boolean is true
    and exists(select 1 from public.applications a where a.id=aid and a.application_type='comp_leave'
     and starts_with(coalesce(a.reviewer_comment,''),'admin_comp_usage:'))
    and not exists(select 1 from public.comp_leave_dates d where d.application_id=aid and not d.admin_direct)
    and not exists(select 1 from public.attendance t where t.source_application_id=aid) then continue; end if;
   if tg_table_name='paid_leave_application_details' then first_day:=(j->>'start_date')::date; last_day:=(j->>'end_date')::date;
   elsif tg_table_name='comp_leave_dates' then first_day:=(j->>'leave_date')::date; last_day:=first_day;
   else first_day:=null;last_day:=null; end if;
   if first_day is not null then
    select keys||coalesce(jsonb_agg(jsonb_build_object('e',e,'m',d::date)),'[]') into keys
     from generate_series(public.driving_closing_month(first_day),public.driving_closing_month(last_day),interval '1 month') d;
   else
    select keys||coalesce(jsonb_agg(jsonb_build_object('e',e,'m',m)),'[]') into keys from (
     select d::date m from public.paid_leave_application_details pd cross join lateral
      generate_series(public.driving_closing_month(pd.start_date),public.driving_closing_month(pd.end_date),interval '1 month') d where pd.application_id=aid
     union select public.driving_closing_month(cd.leave_date) from public.comp_leave_dates cd where cd.application_id=aid
    ) months;
   end if;
  end if;
 end loop;
 for key in select distinct (x->>'e')::bigint e,(x->>'m')::date m from jsonb_array_elements(keys) x order by 1,2 loop
  if key.e=0 then perform public.driving_calendar_lock(key.m,true);
  else
   perform public.driving_month_lock(key.e,key.m,true);
   if tg_table_name in ('applications','paid_leave_application_details','comp_leave_application_details','comp_leave_dates')
    and exists(select 1 from public.driving_report_month_submissions where employee_id=key.e and closing_month=key.m) then
    raise exception 'driving_month_application_locked' using errcode='42501';
   end if;
  end if;
 end loop;
 if tg_table_name='applications' and tg_op='DELETE' then
  insert into public.driving_month_application_deletions(transaction_id,application_id,employee_id,closing_months)
   select pg_catalog.pg_current_xact_id(),old.id,old.employee_id,
    coalesce(array_agg(distinct (x->>'m')::date order by (x->>'m')::date),'{}'::date[])
   from jsonb_array_elements(keys) x;
 end if;
 if tg_op='DELETE' then return old; else return new; end if;
end $$;
do $$declare t text;begin
 foreach t in array array['holidays','attendance','holiday_work_records','applications','paid_leave_application_details','comp_leave_application_details','comp_leave_dates'] loop
  execute format('create trigger a_driving_month_source before insert or update or delete on public.%I for each row execute function public.driving_month_source_guard()',t);
 end loop;
end $$;
-- Preserve the service-only receipt implementation; wrap its entry point so the
-- month lock precedes its refuel/report/receipt/quota locks. No Edge API change.
alter function public.fuel_receipt_command(uuid,text,jsonb) rename to fuel_receipt_command_before_month;
revoke all on function public.fuel_receipt_command_before_month(uuid,text,jsonb) from public,anon,authenticated,service_role;
create function public.fuel_receipt_command(p_actor uuid,p_action text,p_data jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare e bigint; d date; actor bigint;
begin
 select id into actor from public.employees where auth_user_id=p_actor and active;
 if actor is null then raise exception 'active_employee_required' using errcode='42501'; end if;
 if p_action in ('get','reserve','review') then
  select r.employee_id,r.report_date into e,d from public.driving_refuels f join public.driving_reports r on r.id=f.driving_report_id where f.id=(p_data->>'refuel_id')::bigint;
 elsif p_action in ('view','finalize','remove_begin','remove_done','archive_begin','archive_done','file_failure') then
  select r.employee_id,r.report_date into e,d from public.fuel_receipts c join public.driving_reports r on r.id=c.report_id where c.id=(p_data->>'id')::uuid;
 end if;
 if e is not null then perform public.driving_month_lock(e,public.driving_closing_month(d),false); end if;
 return public.fuel_receipt_command_before_month(p_actor,p_action,p_data);
end $$;
revoke all on function public.fuel_receipt_command(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.fuel_receipt_command(uuid,text,jsonb) to service_role;
-- Legacy daily submission still works, but acquires the same lock first.
alter function public.submit_driving_report(bigint) rename to submit_driving_report_before_month;
revoke all on function public.submit_driving_report_before_month(bigint) from public,anon,authenticated,service_role;
create function public.submit_driving_report(p_driving_report_id bigint) returns public.driving_reports
language plpgsql security definer set search_path='' as $$
declare r public.driving_reports%rowtype;
begin
 select * into r from public.driving_reports where id=p_driving_report_id and employee_id=public.current_employee_id();
 if not found then raise exception 'own_draft_report_required'; end if;
 perform public.driving_month_lock(r.employee_id,public.driving_closing_month(r.report_date),false);
 return public.submit_driving_report_before_month(p_driving_report_id);
end $$;
revoke all on function public.submit_driving_report(bigint) from public,anon,authenticated;
grant execute on function public.submit_driving_report(bigint) to authenticated;

create function public.check_driving_report_month(p_closing_month date) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 actor bigint:=public.current_employee_id(); start_date date; end_date date;
 d date; r public.driving_reports%rowtype; a public.attendance%rowtype;
 n integer; hn integer; ht text; leaves integer; full_leaves integer; half_leaves integer; hw integer; leave_app bigint; leave_kind text;
 required boolean; reason text; issue text; days jsonb:='[]'; errors jsonb:='[]';
begin
 if actor is null or auth.uid() is null then raise exception 'active_employee_required' using errcode='42501'; end if;
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
    perform public.driving_report_validate_submission(r);
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

create function public.submit_driving_report_month(p_closing_month date) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor bigint:=public.current_employee_id(); checked jsonb; saved public.driving_report_month_submissions%rowtype;
begin
 if actor is null or auth.uid() is null then raise exception 'active_employee_required' using errcode='42501'; end if;
 -- REPEATABLE READ could retain a stale snapshot after waiting for the gate.
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'read_committed_required'; end if;
 if p_closing_month is null or extract(day from p_closing_month)<>1 then raise exception 'invalid_closing_month'; end if;
 perform public.driving_month_lock(actor,p_closing_month,false);
 perform public.driving_calendar_lock(p_closing_month,false);
 select * into saved from public.driving_report_month_submissions where employee_id=actor and closing_month=p_closing_month;
 if found then return to_jsonb(saved); end if; -- Idempotent after network loss.
 perform id from public.driving_reports where employee_id=actor
  and report_date>=(p_closing_month-interval '1 month'+interval '20 days')::date
  and report_date<p_closing_month+20 order by id for update;
 checked:=public.check_driving_report_month(p_closing_month);
 if not (checked->>'eligible')::boolean then raise exception 'driving_month_not_closed'; end if;
 if not (checked->>'valid')::boolean then raise exception 'driving_month_validation_failed' using detail=(checked->'errors')::text; end if;
 -- Existing submitted reports and their first submitted_at remain untouched.
 update public.driving_reports set status='submitted' where employee_id=actor and status='draft'
  and report_date between (checked->>'period_start')::date and (checked->>'period_end')::date;
 insert into public.driving_report_month_submissions(employee_id,closing_month,period_start,period_end,submitted_by,snapshot)
 values(actor,p_closing_month,(checked->>'period_start')::date,(checked->>'period_end')::date,actor,checked) returning * into saved;
 return to_jsonb(saved);
end $$;
revoke all on function public.driving_month_lock(bigint,date,boolean),public.driving_calendar_lock(date,boolean),
 public.driving_closing_month(date),public.driving_month_balance_application(bigint),public.driving_month_deletion_cleanup(),public.driving_month_source_guard(),public.driving_month_edit_guard(),
 public.check_driving_report_month(date),public.submit_driving_report_month(date) from public,anon,authenticated,service_role;
grant execute on function public.check_driving_report_month(date),public.submit_driving_report_month(date) to authenticated;
notify pgrst,'reload schema';
commit;
