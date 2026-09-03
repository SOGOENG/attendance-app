-- 承認済み申請の印刷済み状態を管理する差分SQL
-- Supabase SQL Editorでファイル全体を実行してください。

begin;

alter table public.applications
  add column if not exists printed_at timestamptz,
  add column if not exists printed_by_employee_id bigint
    references public.employees(id);

create index if not exists applications_approved_printed_idx
  on public.applications(approved_at desc, printed_at)
  where status = 'approved';

create or replace function public.set_application_printed(
  p_application_id bigint,
  p_printed boolean
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_application_admin() then
    raise exception 'admin_required';
  end if;

  update public.applications
  set printed_at = case when p_printed then now() else null end,
      printed_by_employee_id = case
        when p_printed then public.current_employee_id()
        else null
      end
  where id = p_application_id
    and status = 'approved';

  if not found then
    raise exception 'approved_application_required';
  end if;
end;
$$;

revoke all
on function public.set_application_printed(bigint,boolean)
from public;

grant execute
on function public.set_application_printed(bigint,boolean)
to authenticated;

commit;

notify pgrst, 'reload schema';
