-- Apply after fix_comp_leave_expiration_visibility_and_automation.sql.
-- No table changes; audit entries use application_status_history.
begin;

create or replace function public.modify_admin_comp_leave_usage_internal(
  p_application_id bigint, p_employee_id bigint, p_delete boolean,
  p_usage_date date, p_days numeric, p_note text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_app public.applications%rowtype;
  v_date public.comp_leave_dates%rowtype;
  v_record record;
  v_remaining numeric;
  v_take numeric;
  v_actor bigint := public.current_employee_id();
begin
  if public.is_leave_manager() is distinct from true or v_actor is null then
    raise exception '残数管理権限が必要です';
  end if;
  select * into v_app from public.applications where id=p_application_id for update;
  if not found or v_app.employee_id is distinct from p_employee_id
    or v_app.application_type <> 'comp_leave' or v_app.status <> 'approved'
    or not pg_catalog.starts_with(coalesce(v_app.reviewer_comment,''),'admin_comp_usage:') then
    raise exception '有効な管理者直接登録履歴ではありません';
  end if;
  perform 1 from public.employees where id=p_employee_id for key share;
  if not found then raise exception '対象社員が見つかりません'; end if;
  perform 1 from public.comp_leave_dates where application_id=p_application_id for update;
  select * into v_date from public.comp_leave_dates where application_id=p_application_id;
  if not found or not v_date.admin_direct or
    (select count(*) from public.comp_leave_dates where application_id=p_application_id) <> 1 then
    raise exception '管理者直接登録履歴のみ操作できます';
  end if;
  if not p_delete and (p_usage_date is null or p_days is null or p_days<=0
    or p_days::text in ('NaN','Infinity','-Infinity')
    or p_days<>round(p_days,2) or p_days>9999.99) then
    raise exception '使用日と0より大きい使用日数（小数2桁まで）を入力してください';
  end if;
  -- Match approval/submission lock order: application, then work records by ID.
  perform 1 from public.holiday_work_records
    where employee_id=p_employee_id order by id for update;
  perform 1 from public.comp_leave_allocations
    where application_id=p_application_id order by id for update;
  if exists(select 1 from public.comp_leave_allocations ca
    join public.holiday_work_records h on h.id=ca.holiday_work_record_id
    where ca.application_id=p_application_id and h.employee_id<>p_employee_id) then
    raise exception '割当先の対象社員が一致しません';
  end if;
  delete from public.comp_leave_allocations where application_id=p_application_id;
  for v_record in select id from public.holiday_work_records
    where employee_id=p_employee_id order by id
  loop perform public.recalculate_holiday_work_record(v_record.id); end loop;

  if p_delete then
    update public.applications set status='cancelled', updated_at=now(),
      updated_by_employee_id=v_actor where id=p_application_id;
  else
    v_remaining:=p_days;
    -- Shared availability protects submitted reservations. Also retain any
    -- allocations still held by revision_required records, conservatively.
    for v_record in
      select b.id, greatest(b.available_days-coalesce((
        select sum(ca.allocated_days) from public.comp_leave_allocations ca
        join public.applications a on a.id=ca.application_id
        where ca.holiday_work_record_id=b.id and a.application_type='comp_leave'
          and a.status='revision_required'),0),0) as available_days
      from public.get_comp_leave_availability(p_employee_id) b
      where b.remaining_days>0
        and p_usage_date <= (b.work_date+interval '1 year')::date
      order by b.work_date,b.id
    loop
      exit when v_remaining=0;
      v_take:=least(v_remaining,v_record.available_days);
      if v_take<=0 then continue; end if;
      insert into public.comp_leave_allocations(application_id,holiday_work_record_id,allocated_days)
        values(p_application_id,v_record.id,v_take);
      perform public.recalculate_holiday_work_record(v_record.id);
      v_remaining:=v_remaining-v_take;
    end loop;
    if v_remaining<>0 then
      raise exception '使用可能な代休残日数が不足しています（予約分・有効期限を確認してください）';
    end if;
    update public.comp_leave_dates set leave_date=p_usage_date,days=p_days,updated_at=now()
      where id=v_date.id;
    update public.comp_leave_application_details set note=nullif(trim(p_note),''),updated_at=now()
      where application_id=p_application_id;
    update public.applications set applicant_note=nullif(trim(p_note),''),
      updated_at=now(),updated_by_employee_id=v_actor where id=p_application_id;
  end if;
  insert into public.application_status_history
    (application_id,from_status,to_status,comment,changed_by_employee_id)
  values(p_application_id,'approved',case when p_delete then 'cancelled' else 'approved' end,
    (case when p_delete then '管理者直接登録の代休使用を削除：' else '管理者直接登録の代休使用を修正：' end)
      || pg_catalog.jsonb_build_object('before',pg_catalog.jsonb_build_object(
        'usage_date',v_date.leave_date,'days',v_date.days,'note',v_app.applicant_note),
        'after',case when p_delete then null else pg_catalog.jsonb_build_object(
          'usage_date',p_usage_date,'days',p_days,'note',nullif(trim(p_note),'')) end)::text,
    v_actor);
end;
$$;

create or replace function public.update_admin_comp_leave_usage(
  p_application_id bigint,p_employee_id bigint,p_usage_date date,p_days numeric,p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public.modify_admin_comp_leave_usage_internal(
    p_application_id,p_employee_id,false,p_usage_date,p_days,p_note);
end;
$$;

create or replace function public.delete_admin_comp_leave_usage(p_application_id bigint,p_employee_id bigint)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public.modify_admin_comp_leave_usage_internal(
    p_application_id,p_employee_id,true,null,null,null);
end;
$$;

revoke all on function public.modify_admin_comp_leave_usage_internal(bigint,bigint,boolean,date,numeric,text) from public,anon,authenticated;
revoke all on function public.update_admin_comp_leave_usage(bigint,bigint,date,numeric,text) from public,anon,authenticated;
revoke all on function public.delete_admin_comp_leave_usage(bigint,bigint) from public,anon,authenticated;
grant execute on function public.update_admin_comp_leave_usage(bigint,bigint,date,numeric,text) to authenticated;
grant execute on function public.delete_admin_comp_leave_usage(bigint,bigint) to authenticated;
notify pgrst,'reload schema';
commit;
