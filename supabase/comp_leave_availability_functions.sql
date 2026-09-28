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
  -- 新規使用候補だけをJSTの当日で絞る。内部集計は過去取得・予約保護でも使用する。
  return query select b.* from public.comp_leave_availability_internal(p_employee_id) b
    where (statement_timestamp() at time zone 'Asia/Tokyo')::date
      <= (b.work_date + interval '1 year')::date
    order by b.work_date,b.id;
end;
$$;
revoke all on function public.comp_leave_availability_internal(bigint,bigint) from public,anon,authenticated;
revoke all on function public.get_comp_leave_availability(bigint) from public,anon,authenticated;
grant execute on function public.get_comp_leave_availability(bigint) to authenticated;
