-- 本番適用用・準備のみ。今回はSupabaseに実行しない。
-- Apply AFTER create_driving_report_tables.sql, as the same database owner.
-- Run this entire transaction. Existing Auth helpers and RLS are unchanged.
-- Only the driving-report submission blocker is intentionally replaced.
begin;

-- One canonical definition for validation and future UI display; no extra table.
-- Consumers must ORDER BY display_order (SQL result order is not implicit).
create function public.driving_report_inspection_items()
returns table (inspection_item_code text, display_name text, display_order integer)
language sql immutable set search_path = '' as $$
  values
    ('brake_horn', 'ブレーキ機能及びホーンのチェック', 1),
    ('lights', 'ライト類のチェック（ヘッド・ストップ・ウィンカー）', 2),
    ('mirror_visibility', 'バックミラー・視界のチェック', 3),
    ('tires', 'タイヤのチェック', 4),
    ('exterior_interior', '外観の汚れ、損傷・車内清掃はどうか', 5),
    ('driving_posture_seatbelt', '運転姿勢とシートベルトのチェック', 6),
    ('mobile_phone', '携帯電話の処置はよいか', 7),
    ('oil_leak', '車両からの油漏れはないか', 8),
    ('sleep_fatigue', '寝不足ではないか・疲労はないか', 9),
    ('physical_condition', '顔色はよいか、目の玉は生き生きしているか', 10),
    ('alcohol_condition', '運転前後の酒気帯びはないか', 11),
    ('medication', '薬は服用していないか', 12),
    ('worries', '悩み事はないか', 13);
$$;

-- Called by driving_report_prepare() on every draft -> submitted transition.
-- The UPDATE already locks the parent. All detail writes also lock that parent
-- via driving_detail_prepare(), serializing submission with detail changes.
-- Do not expose this helper as an RPC accepting client-provided composite data.
create or replace function public.driving_report_validate_submission(p_report public.driving_reports)
returns void language plpgsql set search_path = '' as $$
begin
  if p_report.employee_id is distinct from public.current_employee_id() then
    raise exception 'own_report_required';
  end if;

  if p_report.driving_status='no_driving' then
    -- A formal no-driving submission, not a missing report or zero-km drive.
    if p_report.vehicle_id is not null or p_report.route_type is not null
      or p_report.route_note is not null or p_report.site_id is not null
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
  if p_report.vehicle_id is null or p_report.route_type is null
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

  -- Existing unique(report_id,check_type), NOT NULL and CHECK constraints enforce
  -- each measurement's values, time, method, and confirmer name.
  if (select count(*) from public.driving_alcohol_checks
      where driving_report_id=p_report.id and check_type='before')<>1
    or (select count(*) from public.driving_alcohol_checks
      where driving_report_id=p_report.id and check_type='after')<>1 then
    raise exception 'before_and_after_alcohol_checks_required';
  end if;
end;
$$;

-- Preferred submission entry point: submit_driving_report(report id).
-- SQL call: SELECT * FROM public.submit_driving_report(123);
-- SECURITY INVOKER preserves RLS; neither admins nor this RPC gain proxy editing.
-- Returns the saved report with DB-owned submission/audit/late-entry values.
-- Direct status UPDATE remains supported, with the SAME mandatory trigger checks.
-- No client-writable flag, custom GUC or RPC-only bypass is used.
create function public.submit_driving_report(p_driving_report_id bigint)
returns public.driving_reports
language plpgsql security invoker set search_path = '' as $$
declare
  v_actor bigint := public.current_employee_id();
  v_report public.driving_reports%rowtype;
begin
  if v_actor is null then raise exception 'active_employee_required'; end if;
  select * into v_report from public.driving_reports
    where id=p_driving_report_id and employee_id=v_actor for update;
  if not found then raise exception 'own_draft_report_required'; end if;
  if v_report.status is distinct from 'draft' then
    raise exception 'draft_report_required';
  end if;
  update public.driving_reports set status='submitted'
    where id=v_report.id and employee_id=v_actor and status='draft'
    returning * into v_report;
  if not found then raise exception 'own_draft_report_required'; end if;
  return v_report;
end;
$$;

-- Correction uses the existing submitted -> draft transition, followed by edits
-- and this RPC again. The existing prepare trigger preserves OLD.submitted_at,
-- sets coalesce(OLD.submitted_at, statement_timestamp()) on submission, and derives
-- greatest((submitted_at AT TIME ZONE 'Asia/Tokyo')::date - report_date, 0).
-- Immutable report_date and first submitted_at keep late_entry(_days) unchanged.
-- Failed submission rolls back the whole RPC and leaves the existing draft intact.
-- No changes to DELETE grants, CSV, snapshots, unique(employee_id,report_date),
-- existing application functions, or existing RLS policies.
revoke all on function public.driving_report_inspection_items(),
  public.submit_driving_report(bigint),
  public.driving_report_validate_submission(public.driving_reports) from public,anon,authenticated;
grant execute on function public.driving_report_inspection_items(),
  public.submit_driving_report(bigint) to authenticated;

commit;
