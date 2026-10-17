-- REVIEW / LOCAL TEST ONLY. Do not apply to production without approval.
-- Apply after add_driving_report_month_submission.sql as the existing owner.
-- Changes only check RPC body; signature, owner, GRANT, RLS and submission locks stay unchanged.
begin;
create or replace function public.check_driving_report_month(p_closing_month date) returns jsonb
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

notify pgrst,'reload schema';
commit;
