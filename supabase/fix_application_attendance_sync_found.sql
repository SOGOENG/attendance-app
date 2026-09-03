-- sync_application_attendance_date() のFOUND上書き不具合を修正する差分SQL
-- 既にadd_application_attendance_sync.sqlを適用したDBで実行してください。

begin;

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

revoke all
on function public.sync_application_attendance_date(bigint,bigint,date,text)
from public;

commit;

notify pgrst, 'reload schema';
