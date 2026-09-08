-- Review only. Requires existing application management and balance-manager permissions.
begin;

alter table public.comp_leave_dates add column if not exists admin_direct boolean not null default false;
-- 通常申請は0.5/1.0、直接登録は正の有限数値に限定する。
-- 表示順のCHECKには触れず、days用CHECKがない場合だけ追加する。
do $$
begin
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.comp_leave_dates'::regclass
      and conname = 'comp_leave_dates_days_check'
  ) then
    alter table public.comp_leave_dates
      add constraint comp_leave_dates_days_check
      check (
        days is not null
        and admin_direct is not null
        and days::text not in ('NaN', 'Infinity', '-Infinity')
        and (
          (admin_direct = false and days in (0.5, 1.0))
          or (admin_direct = true and days > 0)
        )
      ) not valid;
  end if;
end;
$$;
-- 既存データが不適合ならトランザクションを停止する。データは修正しない。
alter table public.comp_leave_dates
  validate constraint comp_leave_dates_days_check;

create or replace function public.guard_admin_comp_leave_date()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.admin_direct or (tg_op='UPDATE' and old.admin_direct) then
    if not public.is_leave_manager() then raise exception '残数管理権限が必要です'; end if;
    if not exists (select 1 from public.applications where id=new.application_id
      and application_type='comp_leave' and status='approved') then
      raise exception '直接登録は承認済み代休記録に限定されます';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists comp_leave_dates_admin_direct_guard on public.comp_leave_dates;
create trigger comp_leave_dates_admin_direct_guard before insert or update on public.comp_leave_dates
  for each row execute function public.guard_admin_comp_leave_date();

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
  select coalesce(sum(remaining_days),0) into v_remaining from public.holiday_work_records
    where employee_id=p_employee_id and status='active';
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
  for v_record in select id,remaining_days from public.holiday_work_records
    where employee_id=p_employee_id and status='active' and remaining_days>0 order by work_date,id
  loop
    exit when v_remaining=0;
    v_take:=least(v_remaining,v_record.remaining_days);
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

create or replace function public.admin_comp_leave_usage_history(p_employee_id bigint)
returns table(id bigint,employee_id bigint,usage_date date,days numeric,note text,
  created_by_employee_id bigint,created_at timestamptz,status text)
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_leave_manager() then raise exception '残数管理権限が必要です'; end if;
  return query select a.id,a.employee_id,d.leave_date,d.days,a.applicant_note,
    a.created_by_employee_id,a.created_at,a.status
    from public.applications a join public.comp_leave_dates d on d.application_id=a.id
    where a.employee_id=p_employee_id and a.application_type='comp_leave' and d.admin_direct
    order by a.created_at desc,a.id desc;
end;
$$;
revoke all on function public.guard_admin_comp_leave_date() from public,anon,authenticated;
revoke all on function public.register_admin_comp_leave_usage(bigint,date,numeric,uuid,text) from public,anon;
revoke all on function public.admin_comp_leave_usage_history(bigint) from public,anon;
grant execute on function public.register_admin_comp_leave_usage(bigint,date,numeric,uuid,text) to authenticated;
grant execute on function public.admin_comp_leave_usage_history(bigint) to authenticated;
notify pgrst,'reload schema';
commit;
