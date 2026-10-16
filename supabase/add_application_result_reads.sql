-- Apply after application_management.sql. Independent of Push delivery history.
begin;

create index if not exists application_status_history_latest_result_idx
  on public.application_status_history(application_id, id desc)
  where from_status is distinct from to_status;

create table if not exists public.application_result_reads (
  employee_id bigint not null references public.employees(id) on delete cascade,
  history_id bigint not null references public.application_status_history(id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key (employee_id, history_id)
);
alter table public.application_result_reads enable row level security;
drop policy if exists application_result_reads_self_select on public.application_result_reads;
create policy application_result_reads_self_select
on public.application_result_reads for select to authenticated
using (employee_id = public.current_employee_id());
revoke all on public.application_result_reads from public, anon, authenticated;
grant select on public.application_result_reads to authenticated;

-- No employee argument: even administrators may only retrieve their own results.
-- Return one latest real status transition per application, not audit-only edits.
create or replace function public.get_unread_application_results()
returns table(history_id bigint, application_id bigint, result_status text)
language sql stable security definer set search_path = '' as $$
  select h.id, a.id, h.to_status
  from public.applications a
  cross join lateral (
    select s.id, s.to_status
    from public.application_status_history s
    where s.application_id = a.id and s.from_status is distinct from s.to_status
    order by s.id desc limit 1
  ) h
  where a.employee_id = public.current_employee_id()
    and a.application_type in ('paid_leave', 'comp_leave')
    and a.status = h.to_status
    and h.to_status in ('approved', 'revision_required', 'rejected')
    and not exists (
      select 1 from public.application_result_reads r
      where r.employee_id = a.employee_id and r.history_id = h.id
    )
  order by h.id;
$$;

create or replace function public.mark_application_results_read(p_history_ids bigint[])
returns void language sql security definer set search_path = '' as $$
  -- Only acknowledge the exact result snapshot the page displayed. A later
  -- approval cannot accidentally be consumed by a delayed acknowledgement.
  insert into public.application_result_reads(employee_id, history_id)
  select public.current_employee_id(), u.history_id
  from public.get_unread_application_results() u
  where u.history_id = any(p_history_ids)
  on conflict (employee_id, history_id) do nothing;
$$;
revoke all on function public.get_unread_application_results() from public, anon, authenticated;
revoke all on function public.mark_application_results_read(bigint[]) from public, anon, authenticated;
grant execute on function public.get_unread_application_results() to authenticated;
grant execute on function public.mark_application_results_read(bigint[]) to authenticated;
notify pgrst, 'reload schema';
commit;
