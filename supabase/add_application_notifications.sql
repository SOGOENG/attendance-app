-- 各種申請の工事部限定・Push通知対応差分
-- Supabase SQL Editorでファイル全体を実行してください。

begin;

create or replace function public.can_use_application_features()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.employees e
    where e.auth_user_id = auth.uid()
      and e.active = true
      and e.department = '工事部'
  )
$$;

create or replace function public.is_application_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.employees e
    where e.auth_user_id = auth.uid()
      and e.active = true
      and (
        e.admin_scope = 'all'
        or regexp_replace(e.name, '[ 　]', '', 'g') = '鈴木和弘'
      )
  )
$$;

alter policy applications_self_insert
on public.applications
with check (
  employee_id = public.current_employee_id()
  and created_by_employee_id = public.current_employee_id()
  and public.can_use_application_features()
  and status = 'draft'
);

-- submit_applicationの既存検証処理は維持し、工事部判定を追加します。
do $$
declare
  v_function regprocedure := 'public.submit_application(bigint)'::regprocedure;
  v_definition text;
  v_marker constant text :=
    'if v_app.employee_id <> public.current_employee_id() then raise exception ''forbidden''; end if;';
  v_replacement constant text := v_marker || E'\n  if not public.can_use_application_features() then raise exception ''construction_department_required''; end if;';
begin
  select pg_get_functiondef(v_function) into v_definition;
  if strpos(v_definition, 'public.can_use_application_features()') = 0 then
    if strpos(v_definition, v_marker) = 0 then
      raise exception 'submit_application authorization marker was not found';
    end if;
    execute replace(v_definition, v_marker, v_replacement);
  end if;
end;
$$;

alter table public.notification_deliveries
  add column if not exists application_id bigint
    references public.applications(id) on delete set null,
  add column if not exists event_type text;

alter table public.notification_deliveries
  drop constraint if exists notification_deliveries_notification_type_check,
  drop constraint if exists notification_deliveries_device_notification_key,
  drop constraint if exists notification_deliveries_application_event_check;

alter table public.notification_deliveries
  add constraint notification_deliveries_notification_type_check
    check (notification_type in (
      'overdue_submission', 'today_schedule', 'tomorrow_schedule',
      'application_submitted', 'application_approved',
      'application_revision_required', 'application_rejected'
    )),
  add constraint notification_deliveries_application_event_check check (
    application_id is null
    or event_type in (
      'submitted', 'approved', 'revision_required', 'rejected'
    )
  );

create index if not exists notification_deliveries_application_event_idx
  on public.notification_deliveries(application_id, event_type, employee_id);

revoke all on function public.can_use_application_features() from public;
grant execute on function public.can_use_application_features() to authenticated;

commit;

notify pgrst, 'reload schema';
