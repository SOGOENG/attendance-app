-- Existing production upgrade. Apply after add_admin_comp_leave_usage.sql.
-- No column, CHECK, trigger, RLS, paid-leave or recalculation changes.
begin;
-- Shared definitions. Included in application_management.sql and the upgrade SQL.
create or replace function public.comp_leave_availability_internal(
  p_employee_id bigint, p_exclude_application_id bigint default null)
returns table(id bigint, work_date date, site_id bigint, remaining_days numeric,
  reserved_days numeric, available_days numeric)
language sql volatile security definer set search_path = '' as $$
  select h.id, h.work_date, h.site_id, h.remaining_days,
    coalesce(r.days,0), greatest(h.remaining_days-coalesce(r.days,0),0)
  from public.holiday_work_records h
  left join lateral (
    select sum(ca.allocated_days) as days
    from public.comp_leave_allocations ca
    join public.applications a on a.id=ca.application_id
    where ca.holiday_work_record_id=h.id
      and a.application_type='comp_leave' and a.status='submitted'
      and a.id is distinct from p_exclude_application_id
  ) r on true
  where h.employee_id=p_employee_id and h.status='active';
$$;

create or replace function public.get_comp_leave_availability(p_employee_id bigint)
returns table(id bigint, work_date date, site_id bigint, remaining_days numeric,
  reserved_days numeric, available_days numeric)
language plpgsql security definer set search_path = '' as $$
begin
  if public.current_employee_id() is null or not (
    p_employee_id=public.current_employee_id()
    or coalesce(public.is_leave_manager(),false)
    or coalesce(public.is_application_admin(),false)
  ) then raise exception 'forbidden'; end if;
  return query select * from public.comp_leave_availability_internal(p_employee_id)
    order by work_date,id;
end;
$$;
revoke all on function public.comp_leave_availability_internal(bigint,bigint) from public,anon,authenticated;
revoke all on function public.get_comp_leave_availability(bigint) from public,anon,authenticated;
grant execute on function public.get_comp_leave_availability(bigint) to authenticated;

create or replace function public.submit_application(p_application_id bigint)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_app public.applications%rowtype;
  v_leave_days numeric(6,2);
  v_allocated_days numeric(6,2);
  v_record_id bigint;
begin
  select * into v_app from public.applications
  where id = p_application_id for update;

  if not found then raise exception 'application_not_found'; end if;
  if v_app.employee_id <> public.current_employee_id() then raise exception 'forbidden'; end if;
  if not public.can_use_application_features() then raise exception 'application_features_unavailable'; end if;
  if v_app.status <> 'draft' then raise exception 'application_not_draft'; end if;

  if v_app.application_type = 'paid_leave' then
    perform public.validate_paid_leave_application(v_app.id);
  elsif v_app.application_type = 'comp_leave' then
    if not exists (select 1 from public.comp_leave_application_details
      where application_id = v_app.id) then
      raise exception 'comp_leave_detail_required';
    end if;
    select coalesce(sum(days), 0) into v_leave_days
    from public.comp_leave_dates where application_id = v_app.id;
    if v_leave_days <= 0 then raise exception 'comp_leave_date_required'; end if;
    select coalesce(sum(allocated_days), 0) into v_allocated_days
    from public.comp_leave_allocations where application_id = v_app.id;
    if v_allocated_days <> v_leave_days then
      raise exception 'comp_leave_allocation_mismatch';
    end if;
    -- Serialize with approval, direct usage and holiday-work correction/cancellation.
    -- Check ownership/status AFTER acquiring locks, using a fresh statement snapshot.
    perform h.id from public.holiday_work_records h
    where h.id in (select ca.holiday_work_record_id from public.comp_leave_allocations ca
      where ca.application_id=v_app.id)
    order by h.id for update;
    if exists (
      select 1 from public.comp_leave_allocations ca
      left join public.holiday_work_records h on h.id=ca.holiday_work_record_id
        and h.employee_id=v_app.employee_id and h.status='active'
      where ca.application_id=v_app.id and h.id is null
    ) then raise exception 'invalid_or_cancelled_holiday_work_record'; end if;
    for v_record_id in select holiday_work_record_id from public.comp_leave_allocations
      where application_id=v_app.id order by holiday_work_record_id
    loop
      perform public.recalculate_holiday_work_record(v_record_id);
    end loop;
    if exists (
      select 1 from public.comp_leave_allocations ca
      join public.comp_leave_availability_internal(v_app.employee_id,v_app.id) b
        on b.id=ca.holiday_work_record_id
      where ca.application_id=v_app.id and ca.allocated_days>b.available_days
    ) then raise exception 'insufficient_comp_leave_balance'; end if;
  else
    raise exception 'unsupported_application_type';
  end if;

  update public.applications
  set status = 'submitted', submitted_at = now()
  where id = v_app.id;

  insert into public.application_status_history
    (application_id, from_status, to_status, changed_by_employee_id)
  values (v_app.id, v_app.status, 'submitted', public.current_employee_id());
end;
$$;

create or replace function public.register_admin_comp_leave_usage(
  p_employee_id bigint,p_usage_date date,p_days numeric,p_request_id uuid,p_note text default null)
returns bigint language plpgsql security definer set search_path = '' as $$
declare v_actor bigint; v_app bigint; v_record record; v_remaining numeric; v_take numeric;
  v_source text; v_previous record;
begin
  if not public.is_leave_manager() then raise exception '残数管理権限が必要です'; end if;
  if p_usage_date is null or p_request_id is null or p_days is null or p_days<=0
    or p_days::text in ('NaN','Infinity','-Infinity') or p_days<>round(p_days,2) or p_days>9999.99 then
    raise exception '使用日と0より大きい使用日数（小数2桁まで）を入力してください';
  end if;
  if not exists(select 1 from public.employees where id=p_employee_id and active=true) then
    raise exception '有効な対象社員を選択してください';
  end if;
  v_actor:=public.current_employee_id();
  v_source:='admin_comp_usage:'||p_request_id::text;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_source,0));
  select a.id,a.employee_id,a.applicant_note,d.leave_date,d.days into v_previous
    from public.applications a join public.comp_leave_dates d on d.application_id=a.id
    where a.reviewer_comment=v_source and d.admin_direct;
  if found then
    if v_previous.employee_id is distinct from p_employee_id or v_previous.leave_date is distinct from p_usage_date
      or v_previous.days is distinct from p_days or v_previous.applicant_note is distinct from nullif(trim(p_note),'') then
      raise exception '同じ登録要求の内容が変更されています';
    end if;
    return v_previous.id;
  end if;
  -- Same lock order as normal approval; FIFO order is applied after all locks.
  for v_record in select id from public.holiday_work_records
    where employee_id=p_employee_id and status='active' order by id for update
  loop perform public.recalculate_holiday_work_record(v_record.id); end loop;
  select coalesce(sum(available_days),0) into v_remaining
    from public.comp_leave_availability_internal(p_employee_id);
  if p_days>v_remaining then raise exception '現在の代休残日数を超えています'; end if;
  -- Insert approved directly: usage-ledger entry, not an attendance application transition.
  -- Existing INSERT actor trigger initially fixes employee to actor; trusted RPC then sets target.
  insert into public.applications(application_type,employee_id,status,approved_at,approved_by_employee_id,
    reviewer_comment,applicant_note,created_by_employee_id)
  values('comp_leave',p_employee_id,'approved',now(),v_actor,v_source,nullif(trim(p_note),''),v_actor)
  returning id into v_app;
  update public.applications set employee_id=p_employee_id where id=v_app;
  insert into public.comp_leave_application_details(application_id,note) values(v_app,nullif(trim(p_note),''));
  insert into public.comp_leave_dates(application_id,leave_date,days,admin_direct)
    values(v_app,p_usage_date,p_days,true);
  v_remaining:=p_days;
  for v_record in select id,available_days from public.comp_leave_availability_internal(p_employee_id)
    where available_days>0 order by work_date,id
  loop
    exit when v_remaining=0;
    v_take:=least(v_remaining,v_record.available_days);
    insert into public.comp_leave_allocations(application_id,holiday_work_record_id,allocated_days)
      values(v_app,v_record.id,v_take);
    perform public.recalculate_holiday_work_record(v_record.id);
    v_remaining:=v_remaining-v_take;
  end loop;
  if v_remaining<>0 then raise exception '代休の割当残数が不足しています'; end if;
  insert into public.application_status_history(application_id,from_status,to_status,comment,changed_by_employee_id)
    values(v_app,null,'approved','管理者直接登録',v_actor);
  return v_app;
end;
$$;


notify pgrst,'reload schema';
commit;
