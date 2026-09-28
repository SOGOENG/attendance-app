-- 前提: add_comp_leave_expiration.sql適用済み。基本SQLの再実行は不要。
-- 関数更新だけを行い、ここでは失効処理・cron登録は実行しない。
begin;
do $$
begin
  if to_regclass('public.comp_leave_expirations') is null
     or to_regprocedure('public.comp_leave_dates_within_expiry(bigint)') is null
     or not exists (
       select 1 from information_schema.columns
       where table_schema = 'public' and table_name = 'holiday_work_records'
         and column_name = 'expired_days'
     ) then
    raise exception 'Apply add_comp_leave_expiration.sql before this migration';
  end if;
end;
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
  -- 新規使用候補だけをJSTの当日で絞る。内部集計は過去取得・予約保護でも使用する。
  return query select b.* from public.comp_leave_availability_internal(p_employee_id) b
    where (statement_timestamp() at time zone 'Asia/Tokyo')::date
      <= (b.work_date + interval '1 year')::date
    order by b.work_date,b.id;
end;
$$;
revoke all on function public.get_comp_leave_availability(bigint) from public, anon, authenticated;
grant execute on function public.get_comp_leave_availability(bigint) to authenticated;

create or replace function
public.expire_comp_leave_records_internal()
returns table(
  holiday_work_record_id bigint,
  newly_expired_days numeric,
  protected_reserved_days numeric
)
language plpgsql
security definer
set search_path = ''
set timezone = 'Asia/Tokyo'
as $$
declare
  v_id bigint;
  v_record public.holiday_work_records%rowtype;
  v_reserved numeric;
  v_expire numeric;
begin

  -- 呼出権限は非公開。手動・service_role専用ラッパーからのみ実行する。

  for v_id in

    select h.id
    from public.holiday_work_records h
    where h.status = 'active'
      and h.remaining_days > 0
      and current_date >=
        (
          (
            h.work_date + interval '1 year'
          )::date + 1
        )
    order by h.id
    for update

  loop

    perform public.recalculate_holiday_work_record(v_id);

    select *
    into v_record
    from public.holiday_work_records h
    where h.id = v_id;

    if v_record.status <> 'active'
       or v_record.remaining_days <= 0
       or current_date <
          (
            (
              v_record.work_date + interval '1 year'
            )::date + 1
          )
    then
      continue;
    end if;

    select coalesce(sum(ca.allocated_days), 0)
    into v_reserved
    from public.comp_leave_allocations ca
    join public.applications a
      on a.id = ca.application_id
    where ca.holiday_work_record_id = v_id
      and a.application_type = 'comp_leave'
      and a.status = 'submitted'
      and public.comp_leave_dates_within_expiry(a.id);

    v_expire :=
      greatest(
        v_record.remaining_days - v_reserved,
        0
      );

    if v_expire <= 0 then
      continue;
    end if;

    update public.holiday_work_records h
    set
      expired_days =
        h.expired_days + v_expire,
      remaining_days =
        h.remaining_days - v_expire,
      updated_by_employee_id =
        public.current_employee_id()
    where h.id = v_id;

    insert into public.comp_leave_expirations as ledger
    (
      holiday_work_record_id,
      employee_id,
      work_date,
      valid_until_date,
      expiration_date,
      expired_at,
      earned_days,
      used_days_at_expiration,
      expired_days,
      site_id,
      note
    )
    values
    (
      v_id,
      v_record.employee_id,
      v_record.work_date,
      (
        v_record.work_date + interval '1 year'
      )::date,
      (
        (
          v_record.work_date + interval '1 year'
        )::date + 1
      ),
      now(),
      v_record.earned_days,
      v_record.used_days,
      v_record.expired_days + v_expire,
      v_record.site_id,
      v_record.note
    )
    on conflict
      on constraint comp_leave_expirations_holiday_work_record_id_key
    do update
    set
      employee_id = excluded.employee_id,
      work_date = excluded.work_date,
      valid_until_date = excluded.valid_until_date,
      expiration_date = excluded.expiration_date,
      expired_at = excluded.expired_at,
      earned_days = excluded.earned_days,
      used_days_at_expiration = excluded.used_days_at_expiration,
      expired_days = excluded.expired_days,
      site_id = excluded.site_id,
      note = excluded.note;

    perform public.recalculate_holiday_work_record(v_id);

    holiday_work_record_id := v_id;
    newly_expired_days := v_expire;
    protected_reserved_days := v_reserved;

    return next;

  end loop;

end;
$$;

create or replace function public.expire_comp_leave_records()
returns table(
  holiday_work_record_id bigint,
  newly_expired_days numeric,
  protected_reserved_days numeric
)
language plpgsql
security definer
set search_path = ''
set timezone = 'Asia/Tokyo'
as $$
begin
  if public.current_employee_id() is null
     or not coalesce(public.is_leave_manager(), false)
  then
    raise exception 'leave_manager_required';
  end if;
  return query select * from public.expire_comp_leave_records_internal();
end;
$$;

-- service_role専用。一般ユーザーのJWTでは実行不可。
create or replace function public.expire_comp_leave_records_automated()
returns table(
  holiday_work_record_id bigint,
  newly_expired_days numeric,
  protected_reserved_days numeric
)
language plpgsql
security definer
set search_path = ''
set timezone = 'Asia/Tokyo'
as $$
begin
  return query select * from public.expire_comp_leave_records_internal();
end;
$$;

revoke all on function public.expire_comp_leave_records_internal()
  from public, anon, authenticated, service_role;
revoke all on function public.expire_comp_leave_records_automated()
  from public, anon, authenticated, service_role;
grant execute on function public.expire_comp_leave_records_automated() to service_role;
revoke all on function public.expire_comp_leave_records()
  from public, anon, authenticated, service_role;
grant execute on function public.expire_comp_leave_records() to authenticated;

notify pgrst, 'reload schema';
commit;
