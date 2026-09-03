-- 残数管理者が、選択した社員の有給・代休使用履歴を参照するための権限差分。
-- Supabase SQL Editorでファイル全体を実行してください。

begin;

alter policy applications_self_or_admin_select
on public.applications
using (
  employee_id = public.current_employee_id()
  or public.is_application_admin()
  or (
    public.is_leave_manager()
    and status = 'approved'
    and application_type in ('paid_leave', 'comp_leave')
  )
);

alter policy paid_leave_details_self_or_admin_select
on public.paid_leave_application_details
using (exists (
  select 1
  from public.applications a
  where a.id = application_id
    and (
      a.employee_id = public.current_employee_id()
      or public.is_application_admin()
      or (public.is_leave_manager() and a.status = 'approved')
    )
));

alter policy comp_leave_dates_self_or_admin_select
on public.comp_leave_dates
using (exists (
  select 1
  from public.applications a
  where a.id = application_id
    and (
      a.employee_id = public.current_employee_id()
      or public.is_application_admin()
      or (public.is_leave_manager() and a.status = 'approved')
    )
));

alter policy comp_leave_allocations_self_or_admin_select
on public.comp_leave_allocations
using (exists (
  select 1
  from public.applications a
  where a.id = application_id
    and (
      a.employee_id = public.current_employee_id()
      or public.is_application_admin()
      or (public.is_leave_manager() and a.status = 'approved')
    )
));

commit;

notify pgrst, 'reload schema';
