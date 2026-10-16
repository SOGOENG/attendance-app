-- 本番未適用。add_driving_report_submission.sql 適用後に全体を実行。
-- Preserve all old before/after rows and their meaning, methods, names and values.
begin;
alter table public.driving_reports add column alcohol_check_version smallint not null default 1
  check(alcohol_check_version in (1,2));
alter table public.driving_reports alter column alcohol_check_version set default 2;
alter table public.driving_alcohol_checks drop constraint driving_alcohol_checks_check_type_check;
alter table public.driving_alcohol_checks add constraint driving_alcohol_checks_check_type_check
  check(check_type in ('before','after','commute_before','return_before'));
alter table public.driving_alcohol_checks add column phone_confirmed boolean;
alter table public.driving_alcohol_checks alter column checked_at drop not null;
alter table public.driving_alcohol_checks alter column alcohol_value drop not null;
alter table public.driving_alcohol_checks alter column confirmation_method drop not null;
alter table public.driving_alcohol_checks alter column confirmed_by_name_snapshot drop not null;
alter table public.driving_alcohol_checks add constraint driving_alcohol_legacy_required check(
  check_type not in ('before','after') or (checked_at is not null and alcohol_value is not null
    and confirmation_method is not null and confirmed_by_name_snapshot is not null));
alter table public.driving_alcohol_checks add constraint driving_alcohol_pre_drive_confirmer check(
  check_type not in ('commute_before','return_before') or
  (confirmed_by_employee_id is null and (confirmed_by_name_snapshot is null or confirmed_by_name_snapshot in ('中尾','安藤'))));
create function public.driving_report_alcohol_version_prepare()
returns trigger language plpgsql set search_path='' as $$
begin
  if tg_op='INSERT' then new.alcohol_check_version:=2;
  elsif old.alcohol_check_version=2 and new.alcohol_check_version is distinct from 2 then
    raise exception 'alcohol_version_downgrade_not_allowed';
  end if;
  return new;
end;
$$;
create trigger driving_report_alcohol_version_prepare before insert or update on public.driving_reports
  for each row execute function public.driving_report_alcohol_version_prepare();
-- Normalize only NEW-format rows, before the existing detail owner/draft guard.
create function public.driving_alcohol_pre_drive_prepare()
returns trigger language plpgsql set search_path='' as $$
begin
  if new.check_type in ('commute_before','return_before') then
    new.confirmation_method:=case when new.phone_confirmed then '電話確認○' when new.phone_confirmed=false then '電話確認×' else null end;
    new.confirmed_by_employee_id:=null;
    -- New-format direct detail writes also upgrade a legacy draft. This UPDATE
    -- is subject to existing owner RLS and the parent's prepare trigger.
    update public.driving_reports set alcohol_check_version=2
      where id=new.driving_report_id and employee_id=public.current_employee_id()
        and status='draft' and alcohol_check_version=1;
  end if;
  return new;
end;
$$;
create trigger driving_alcohol_pre_drive_prepare before insert or update on public.driving_alcohol_checks
  for each row execute function public.driving_alcohol_pre_drive_prepare();
create or replace function public.driving_report_validate_submission(p_report public.driving_reports)
returns void language plpgsql set search_path = '' as $$
begin
  if p_report.employee_id is distinct from public.current_employee_id() then
    raise exception 'own_report_required';
  end if;

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

revoke all on function public.driving_report_alcohol_version_prepare(),public.driving_alcohol_pre_drive_prepare(),
  public.driving_report_validate_submission(public.driving_reports) from public,anon,authenticated;
notify pgrst,'reload schema';
commit;
