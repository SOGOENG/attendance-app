-- PREPARATION ONLY: no production application. Isolated local tests are allowed.
-- Requires month submission, destination, pre-drive alcohol, vehicle-name snapshot,
-- fuel receipt migrations. Independent read-only RPC; no existing function/policy changes.
-- Apply only as a reviewed, non-login-to-browser owner (normally postgres).
begin;

create function public.admin_driving_report_csv_source(p_closing_month date)
returns jsonb
language plpgsql stable security definer set search_path = '' set row_security = off as $$
declare
  v_start date;
  v_end date;
  v_result jsonb;
begin
  if auth.uid() is null or not coalesce(public.is_application_admin(),false) then
    raise exception 'admin_required' using errcode='42501';
  end if;
  -- RLS must never silently hide submissions, historical refuels, or master rows.
  -- row_security=off raises when this owner cannot read unfiltered rows; it does
  -- not disable RLS on any table/session outside this function.
  -- Also reject execution when required column SELECT grants are missing.
  perform e.id,e.name,e.department,e.active from public.employees e limit 0;
  perform m.* from public.driving_report_month_submissions m limit 0;
  perform r.* from public.driving_reports r limit 0;
  perform i.* from public.driving_report_inspections i limit 0;
  perform a.* from public.driving_alcohol_checks a limit 0;
  perform f.* from public.driving_refuels f limit 0;
  perform a.id,a.application_type from public.applications a limit 0;
  perform c.report_id,c.state from public.fuel_receipts c limit 0;
  if p_closing_month is null or extract(day from p_closing_month)<>1
     or p_closing_month<date '1001-01-01' or p_closing_month>date '9998-12-01' then
    raise exception 'invalid_closing_month';
  end if;
  v_start := (p_closing_month-interval '1 month'+interval '20 days')::date;
  v_end := p_closing_month+19;
  if (statement_timestamp() at time zone 'Asia/Tokyo')::date<=v_end then
    raise exception 'driving_month_not_closed';
  end if;

  -- One statement / snapshot. No gate locks, writes, submit RPC or receipt command.
  -- A single JSON envelope avoids PostgREST row-limit truncation of child arrays.
  with months as materialized (
    select m.* from public.driving_report_month_submissions m where m.closing_month=p_closing_month
  ), reports as materialized (
    select r.* from public.driving_reports r join months m on m.employee_id=r.employee_id
    where r.report_date between v_start and v_end
  ), cars as (
    select distinct vehicle_id from reports where vehicle_id is not null
  ), history as materialized (
    select f.*,r.vehicle_id,r.report_date,r.status as report_status,
      case when r.status='submitted' then (
        select m.id from public.driving_report_month_submissions m
        where m.employee_id=r.employee_id and m.closing_month=(date_trunc('month',r.report_date::timestamp)
          +case when extract(day from r.report_date)>=21 then interval '1 month' else interval '0' end)::date
          and m.period_start<=r.report_date and m.period_end>=r.report_date
          and m.snapshot->>'valid'='true' and m.snapshot->'errors'='[]'::jsonb
          and m.snapshot->>'closing_month'=m.closing_month::text
          and m.snapshot->>'period_start'=m.period_start::text and m.snapshot->>'period_end'=m.period_end::text
          and exists(select 1 from jsonb_array_elements(
            case when jsonb_typeof(m.snapshot->'days')='array' then m.snapshot->'days' else '[]'::jsonb end
          ) d where d->>'report_id'=r.id::text and d->>'date'=r.report_date::text and d->>'required'='true' and d->>'issue' is null)
      ) end as month_submission_id
    from public.driving_refuels f join public.driving_reports r on r.id=f.driving_report_id
    join cars c on c.vehicle_id=r.vehicle_id
    where f.refueled_at<(v_start::timestamp at time zone 'Asia/Tokyo')
  ), history_summary as materialized (
    select c.vehicle_id,
      chosen.id as selected_id, earlier.id as earlier_id,
      (select count(*) from history h where h.vehicle_id=c.vehicle_id and h.month_submission_id is not null
        and h.refueled_at=chosen.refueled_at) as same_timestamp_candidate_count,
      exists(select 1 from history h where h.vehicle_id=c.vehicle_id and h.month_submission_id is null
        and (chosen.id is null or h.refueled_at>=chosen.refueled_at)) as has_newer_unconfirmed_history
    from cars c
    left join lateral (
      select h.id,h.refueled_at from history h where h.vehicle_id=c.vehicle_id and h.month_submission_id is not null
      order by h.refueled_at desc,h.id desc limit 1
    ) chosen on true
    left join lateral (
      select h.id from history h where h.vehicle_id=c.vehicle_id and h.month_submission_id is not null
        and h.refueled_at<chosen.refueled_at order by h.refueled_at desc,h.id desc limit 1
    ) earlier on true
  ), bounded_history as (
    select h.* from history h join history_summary s on s.vehicle_id=h.vehicle_id
      and (h.id=s.selected_id or h.id=s.earlier_id)
  )
  select jsonb_build_object(
    'source_version',2,'visibility_guarantee','unfiltered_admin_v1','roster_basis','manual_confirmation_required',
    'closing_month',p_closing_month,'period_start',v_start,'period_end',v_end,
    'exported_at',statement_timestamp(),
    'employees',coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'name',e.name,
      'department',e.department,'active',e.active) order by e.id) from public.employees e
      where e.active or exists(select 1 from months m where m.employee_id=e.id)),'[]'::jsonb),
    'submissions',coalesce((select jsonb_agg(to_jsonb(m) order by m.employee_id) from months m),'[]'::jsonb),
    'reports',coalesce((select jsonb_agg(to_jsonb(r) order by r.employee_id,r.report_date,r.id) from reports r),'[]'::jsonb),
    'inspections',coalesce((select jsonb_agg(to_jsonb(i) order by i.driving_report_id,i.inspection_item_code)
      from public.driving_report_inspections i join reports r on r.id=i.driving_report_id),'[]'::jsonb),
    'alcohol',coalesce((select jsonb_agg(to_jsonb(a) order by a.driving_report_id,a.check_type)
      from public.driving_alcohol_checks a join reports r on r.id=a.driving_report_id),'[]'::jsonb),
    'refuels',coalesce((select jsonb_agg(to_jsonb(f) order by f.driving_report_id,f.refueled_at,f.id)
      from public.driving_refuels f join reports r on r.id=f.driving_report_id),'[]'::jsonb),
    'history',coalesce((select jsonb_agg(to_jsonb(h) order by h.vehicle_id,h.refueled_at,h.id) from bounded_history h),'[]'::jsonb),
    'history_summary',coalesce((select jsonb_agg(to_jsonb(s) order by s.vehicle_id) from history_summary s),'[]'::jsonb),
    'leave_applications',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'application_type',a.application_type))
      from public.applications a where exists(select 1 from months m cross join lateral jsonb_array_elements(
        case when jsonb_typeof(m.snapshot->'days')='array' then m.snapshot->'days' else '[]'::jsonb end
      ) d where d->>'leave_application_id'=a.id::text)),'[]'::jsonb),
    'pending_receipts',coalesce((select jsonb_agg(c.report_id) from public.fuel_receipts c
      join reports r on r.id=c.report_id where c.state in ('pending','deleting')),'[]'::jsonb)
  ) into v_result;
  -- Fail rather than return a partial export for unexpectedly large histories.
  if octet_length(v_result::text)>67108864 then raise exception 'csv_export_too_large'; end if;
  return v_result;
end;
$$;

revoke all on function public.admin_driving_report_csv_source(date) from public,anon,authenticated,service_role;
grant execute on function public.admin_driving_report_csv_source(date) to authenticated;
-- No table grants / existing policies are changed. No service_role browser key.
-- SECURITY DEFINER is confined to this fixed read query after the Auth admin check.
notify pgrst,'reload schema';
commit;
