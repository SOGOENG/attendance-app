-- DEVELOPMENT TEST ONLY. Preparation/review artifact; do NOT apply to production
-- in this task. Does not change admin_driving_report_csv_source(date) or any RLS.
-- New read surface requires separate approval before deployment.
-- Fixed scope: employee 39, September 2026, exactly the five saved draft dates.
begin;

create function public.admin_driving_report_draft_test_source()
returns jsonb
language plpgsql stable security definer set search_path='' set row_security=off as $$
declare
  v_dates date[]:=array[date '2026-08-21',date '2026-08-24',date '2026-08-25',date '2026-08-26',date '2026-08-27'];
  v_result jsonb;
begin
  if auth.uid() is null or not coalesce(public.is_application_admin(),false) then
    raise exception 'admin_required' using errcode='42501';
  end if;
  -- Full reads or an error: no silent RLS filtering. No table grants are added.
  if exists(select 1 from public.driving_report_month_submissions
    where employee_id=39 and closing_month=date '2026-09-01') then
    raise exception 'test_month_already_submitted';
  end if;
  if (select count(*) from public.driving_reports
      where employee_id=39 and report_date=any(v_dates) and status='draft')<>5 then
    raise exception 'expected_five_saved_drafts';
  end if;
  with reports as materialized (
    select r.* from public.driving_reports r where r.employee_id=39
      and r.report_date=any(v_dates) and r.status='draft'
  )
  select jsonb_build_object(
    'source_version','draft_test_1','visibility_guarantee','unfiltered_admin_v1',
    'test_scope','employee39_202609_five_days','export_kind','TEST_DRAFT','employee_id',39,
    'closing_month',date '2026-09-01','period_start',date '2026-08-21','period_end',date '2026-09-20',
    'exported_at',statement_timestamp(),'month_submission_exists',false,'history_verification','not_checked',
    'employees',coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'name',e.name,'department',e.department,'active',e.active))
      from public.employees e where e.id=39),'[]'::jsonb),
    'reports',coalesce((select jsonb_agg(to_jsonb(r) order by r.report_date,r.id) from reports r),'[]'::jsonb),
    'inspections',coalesce((select jsonb_agg(to_jsonb(i) order by i.driving_report_id,i.inspection_item_code)
      from public.driving_report_inspections i join reports r on r.id=i.driving_report_id),'[]'::jsonb),
    'alcohol',coalesce((select jsonb_agg(to_jsonb(a) order by a.driving_report_id,a.check_type)
      from public.driving_alcohol_checks a join reports r on r.id=a.driving_report_id),'[]'::jsonb),
    'refuels',coalesce((select jsonb_agg(to_jsonb(f) order by f.driving_report_id,f.refueled_at,f.id)
      from public.driving_refuels f join reports r on r.id=f.driving_report_id),'[]'::jsonb)
  ) into v_result;
  if octet_length(v_result::text)>67108864 then raise exception 'csv_export_too_large'; end if;
  return v_result;
end;
$$;
revoke all on function public.admin_driving_report_draft_test_source() from public,anon,authenticated,service_role;
grant execute on function public.admin_driving_report_draft_test_source() to authenticated;
notify pgrst,'reload schema';
commit;
