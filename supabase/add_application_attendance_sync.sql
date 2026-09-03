-- 各種申請の承認結果を出勤簿へ同期する差分SQL
-- Supabase SQL Editorでファイル全体を実行してください。

begin;

-- 申請から反映した出勤簿行を識別し、取消時にその行だけを戻せるようにする。
alter table public.attendance
  add column if not exists source_type text,
  add column if not exists source_application_id bigint;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.attendance'::regclass
      and conname = 'attendance_source_application_fk'
  ) then
    alter table public.attendance
      add constraint attendance_source_application_fk
      foreign key (source_application_id) references public.applications(id);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.attendance'::regclass
      and conname = 'attendance_application_source_check'
  ) then
    alter table public.attendance
      add constraint attendance_application_source_check check (
        (source_type is null and source_application_id is null)
        or (source_type = 'application' and source_application_id is not null)
      );
  end if;
end;
$$;

create unique index if not exists attendance_application_source_date_uidx
  on public.attendance (source_application_id, work_date)
  where source_application_id is not null;

create index if not exists attendance_employee_work_date_idx
  on public.attendance (employee_id, work_date);

create or replace function public.protect_application_attendance_row()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if current_setting('app.application_attendance_sync', true) = 'on' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if tg_op = 'INSERT' and new.source_application_id is not null then
    raise exception 'application_attendance_managed_by_rpc';
  elsif tg_op = 'DELETE' and old.source_application_id is not null then
    raise exception 'application_attendance_managed_by_rpc';
  elsif tg_op = 'UPDATE' then
    if old.source_application_id is null and new.source_application_id is not null then
      raise exception 'application_attendance_managed_by_rpc';
    end if;
    if old.source_application_id is not null and (
      new.employee_id is distinct from old.employee_id
      or new.work_date is distinct from old.work_date
      or new.site_type is distinct from old.site_type
      or new.site_id is distinct from old.site_id
      or new.misc_company is distinct from old.misc_company
      or new.misc_department is distinct from old.misc_department
      or new.company_work is distinct from old.company_work
      or new.misc_name is distinct from old.misc_name
      or new.leave_type is distinct from old.leave_type
      or new.start_time is distinct from old.start_time
      or new.end_time is distinct from old.end_time
      or new.note is distinct from old.note
      or new.source_type is distinct from old.source_type
      or new.source_application_id is distinct from old.source_application_id
    ) then
      raise exception 'application_attendance_managed_by_rpc';
    end if;
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists protect_application_attendance_row on public.attendance;
create trigger protect_application_attendance_row
before insert or update or delete on public.attendance
for each row execute function public.protect_application_attendance_row();

create or replace function public.sync_application_attendance_date(
  p_application_id bigint,
  p_employee_id bigint,
  p_work_date date,
  p_leave_type text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.attendance%rowtype;
  v_count integer;
  v_row_found boolean;
begin
  if p_leave_type not in ('有給', '代休') then
    raise exception 'invalid_attendance_leave_type';
  end if;

  select count(*) into v_count
  from public.attendance
  where employee_id = p_employee_id and work_date = p_work_date;
  if v_count > 1 then
    raise exception 'duplicate_attendance_rows_for_date:%', p_work_date;
  end if;

  select * into v_row
  from public.attendance
  where employee_id = p_employee_id and work_date = p_work_date
  order by id
  limit 1
  for update;

  v_row_found := found;
  perform set_config('app.application_attendance_sync', 'on', true);

  if v_row_found then
    if v_row.source_application_id is not null
       and v_row.source_application_id <> p_application_id then
      raise exception 'attendance_date_already_managed_by_application:%', p_work_date;
    end if;
    if v_row.source_application_id is null and (
      coalesce(v_row.status, 'draft') <> 'draft'
      or (
        coalesce(v_row.site_type, '') <> ''
        and not (
          p_leave_type = '有給'
          and v_row.site_type = '有給奨励日'
        )
      )
      or v_row.site_id is not null
      or coalesce(v_row.misc_company, '') <> ''
      or coalesce(v_row.misc_department, '') <> ''
      or coalesce(v_row.company_work, '') <> ''
      or coalesce(v_row.misc_name, '') <> ''
      or coalesce(v_row.leave_type, '') <> ''
      or coalesce(v_row.start_time, '') <> ''
      or coalesce(v_row.end_time, '') <> ''
      or coalesce(v_row.note, '') <> ''
    ) then
      raise exception 'attendance_date_has_existing_input:%', p_work_date;
    end if;

    update public.attendance
    set site_type = '休み', site_id = null,
        misc_company = '', misc_department = '', company_work = '', misc_name = '',
        leave_type = p_leave_type, start_time = '', end_time = '', note = '',
        status = 'draft', source_type = 'application',
        source_application_id = p_application_id
    where id = v_row.id;
  else
    insert into public.attendance
      (employee_id, work_date, site_type, site_id, misc_company,
       misc_department, company_work, misc_name, leave_type,
       start_time, end_time, note, status, source_type, source_application_id)
    values
      (p_employee_id, p_work_date, '休み', null, '', '', '', '', p_leave_type,
       '', '', '', 'draft', 'application', p_application_id);
  end if;
end;
$$;

create or replace function public.sync_approved_application_attendance(
  p_application_id bigint
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_app public.applications%rowtype;
  v_paid public.paid_leave_application_details%rowtype;
  v_date date;
  v_business_days numeric;
begin
  select * into v_app from public.applications where id = p_application_id;
  if not found then raise exception 'application_not_found'; end if;
  if v_app.status <> 'approved' then raise exception 'approved_application_required'; end if;

  if v_app.application_type = 'paid_leave' then
    select * into v_paid from public.paid_leave_application_details
    where application_id = v_app.id;
    if not found then raise exception 'paid_leave_detail_required'; end if;
    if v_paid.day_part <> 'full' or v_paid.days <> trunc(v_paid.days) then
      raise exception 'attendance_half_day_sync_not_supported';
    end if;

    -- holidaysには既存カレンダーが確定した「出勤」も保存される。
    -- 有給奨励日と祝日週の土曜（出勤）は稼働日として数え、休日・祝日だけ除外する。
    select count(*) into v_business_days
    from generate_series(v_paid.start_date, v_paid.end_date, interval '1 day') d
    where not exists (
      select 1 from public.holidays h
      where h.date = d::date
        and h.day_type in ('休日', '祝日')
    );
    if v_business_days <> v_paid.days then
      raise exception 'paid_leave_business_days_mismatch';
    end if;

    for v_date in
      select d::date
      from generate_series(v_paid.start_date, v_paid.end_date, interval '1 day') d
      where not exists (
        select 1 from public.holidays h
        where h.date = d::date
          and h.day_type in ('休日', '祝日')
      )
      order by d
    loop
      perform public.sync_application_attendance_date(
        v_app.id, v_app.employee_id, v_date, '有給'
      );
    end loop;
  elsif v_app.application_type = 'comp_leave' then
    if exists (
      select 1 from public.comp_leave_dates
      where application_id = v_app.id and days <> 1
    ) then
      raise exception 'attendance_half_day_sync_not_supported';
    end if;
    for v_date in
      select leave_date from public.comp_leave_dates
      where application_id = v_app.id order by leave_date
    loop
      perform public.sync_application_attendance_date(
        v_app.id, v_app.employee_id, v_date, '代休'
      );
    end loop;
  end if;
end;
$$;

create or replace function public.handle_application_attendance_status()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.status = 'approved' and old.status <> 'approved' then
    perform public.sync_approved_application_attendance(new.id);
  elsif old.status = 'approved' and new.status = 'cancelled' then
    perform set_config('app.application_attendance_sync', 'on', true);
    delete from public.attendance where source_application_id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists application_attendance_status_sync on public.applications;
create trigger application_attendance_status_sync
after update of status on public.applications
for each row
when (old.status is distinct from new.status)
execute function public.handle_application_attendance_status();

revoke all on function public.protect_application_attendance_row() from public;
revoke all on function public.sync_application_attendance_date(bigint,bigint,date,text) from public;
revoke all on function public.sync_approved_application_attendance(bigint) from public;
revoke all on function public.handle_application_attendance_status() from public;

commit;

notify pgrst, 'reload schema';
