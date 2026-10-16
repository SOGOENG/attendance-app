-- 本番適用用・準備のみ。今回はSupabaseに実行しない。
-- Apply after create_driving_report_tables.sql, as the employees table owner.
-- Run the whole transaction. Conflicting columns/functions stop rather than reuse.
-- Existing employee grants, RLS, triggers and profile Edge Functions are unchanged.
-- Repository investigation: see employee_default_vehicle_notes.md for limitations
-- and read-only catalog queries to run BEFORE applying in the real environment.
begin;

alter table public.employees
  add column default_vehicle_id bigint
    references public.vehicles(id) on update restrict on delete restrict;
comment on column public.employees.default_vehicle_id is
  '通常使用車両（任意）。日報ごとの使用車両とは独立。設定後の車両無効化では参照を保持。';
create index employees_default_vehicle_idx on public.employees(default_vehicle_id)
  where default_vehicle_id is not null;

-- No employee ID / profile data is accepted from the caller. SECURITY DEFINER
-- avoids granting new UPDATE privileges or broadening existing employee RLS.
-- Only the single new column is assigned, never name/department/job_title,
-- profile_email/phone_number, Auth identity, active or administrator flags.
create function public.set_my_default_vehicle(p_vehicle_id bigint)
returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  v_actor bigint := public.current_employee_id();
  v_employee_id bigint;
  v_saved_vehicle bigint;
begin
  if v_actor is null or auth.uid() is null then
    raise exception 'active_employee_required';
  end if;

  -- Lock and recheck the actual Auth binding / active state, rather than trusting
  -- a caller-supplied employee id or a stale localStorage profile.
  select e.id into v_employee_id from public.employees e
    where e.id=v_actor and e.auth_user_id=auth.uid() and e.active=true
    for update;
  if not found then raise exception 'active_employee_required'; end if;

  if p_vehicle_id is not null then
    -- FOR SHARE also locks non-key updates such as active=false until commit.
    -- A later deactivation is allowed and does not erase the stored preference.
    perform 1 from public.vehicles v where v.id=p_vehicle_id and v.active=true for share;
    if not found then raise exception 'active_vehicle_required'; end if;
  end if;

  update public.employees set default_vehicle_id=p_vehicle_id
    where id=v_employee_id and auth_user_id=auth.uid() and active=true
    returning default_vehicle_id into v_saved_vehicle;
  if not found then raise exception 'active_employee_required'; end if;
  return v_saved_vehicle;
end;
$$;
revoke all on function public.set_my_default_vehicle(bigint) from public,anon,authenticated;
grant execute on function public.set_my_default_vehicle(bigint) to authenticated;

-- NULL clears the setting. Even the currently saved vehicle cannot be set again
-- through this RPC while inactive; users can clear it or choose an active vehicle.
-- No uniqueness on default_vehicle_id: this is a preference, not a car assignment
-- reservation. No driving_report is created, modified or retrospectively changed.
-- No new direct UPDATE/SELECT grants or policies on employees are introduced.
commit;
