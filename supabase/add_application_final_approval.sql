-- Apply after application_management.sql and add_application_print_status.sql.
-- No historical approvals or employee permissions are inferred.
begin;
alter table public.employees add column if not exists is_application_final_approver boolean not null default false;
alter table public.applications
 add column if not exists final_approval_required boolean not null default false,
 add column if not exists final_confirmed_at timestamptz,
 add column if not exists final_confirmed_by_employee_id bigint references public.employees(id);
alter table public.applications drop constraint if exists applications_final_confirmation_pair;
alter table public.applications add constraint applications_final_confirmation_pair check
 ((final_confirmed_at is null) = (final_confirmed_by_employee_id is null));
drop index if exists public.applications_final_waiting_idx;
create index applications_final_waiting_idx on public.applications(approved_at,id)
 where status='approved' and final_approval_required and final_confirmed_at is null;

create or replace function public.is_application_final_approver()
returns boolean language sql stable security definer set search_path = '' as $$
 select coalesce(public.is_application_admin(),false) and exists
 (select 1 from public.employees where id=public.current_employee_id()
 and active=true and is_application_final_approver=true)
$$;

-- Invoker triggers distinguish direct API writes from trusted SECURITY DEFINER RPCs.
-- The employee flag remains editable through the Supabase SQL editor/service role only.
create or replace function public.guard_application_final_fields()
returns trigger language plpgsql set search_path = '' as $$
begin
 if TG_TABLE_NAME='employees' then
  if current_user in ('anon','authenticated','authenticator') and
    ((TG_OP='INSERT' and new.is_application_final_approver) or
     (TG_OP='UPDATE' and new.is_application_final_approver is distinct from old.is_application_final_approver)) then
   raise exception 'final_approver_flag_sql_only';
  end if;
  return new;
 end if;
 if current_user in ('anon','authenticated','authenticator') then
  if TG_OP='INSERT' then
   if new.final_approval_required then raise exception 'final_flow_server_managed'; end if;
   if new.final_confirmed_at is not null or new.final_confirmed_by_employee_id is not null then
    raise exception 'final_confirmation_rpc_required';
   end if;
  elsif new.final_approval_required is distinct from old.final_approval_required then
   raise exception 'final_flow_server_managed';
  elsif new.final_confirmed_at is distinct from old.final_confirmed_at or
        new.final_confirmed_by_employee_id is distinct from old.final_confirmed_by_employee_id then
   raise exception 'final_confirmation_rpc_required';
  end if;
 end if;
 -- Hooks the actual submitted transition of submit_application, including resubmission.
 -- Existing submitted/approved rows are untouched; no date inference or backfill.
 if new.status='submitted' then
  if TG_OP='INSERT' then new.final_approval_required := true;
  elsif old.status is distinct from 'submitted' then new.final_approval_required := true;
  end if;
 end if;
 if new.status <> 'approved' or (TG_OP='UPDATE' and old.status <> 'approved') then
  new.final_confirmed_at := null;
  new.final_confirmed_by_employee_id := null;
 end if;
 if new.final_approval_required and new.status <> 'approved' then
  new.printed_at := null;
  new.printed_by_employee_id := null;
 end if;
 if TG_OP='INSERT' then
  if new.final_approval_required and new.printed_at is not null and new.final_confirmed_at is null then
   raise exception 'final_confirmation_required';
  end if;
 elsif new.final_approval_required and
       (new.printed_at is distinct from old.printed_at or new.printed_by_employee_id is distinct from old.printed_by_employee_id) and new.printed_at is not null
       and (new.status <> 'approved' or new.final_confirmed_at is null) then
  raise exception 'final_confirmation_required';
 end if;
 return new;
end;
$$;
drop trigger if exists guard_application_final_fields on public.applications;
create trigger guard_application_final_fields before insert or update on public.applications
 for each row execute function public.guard_application_final_fields();
drop trigger if exists guard_employee_final_permission on public.employees;
create trigger guard_employee_final_permission before insert or update on public.employees
 for each row execute function public.guard_application_final_fields();

create or replace function public.confirm_application_final(p_application_id bigint)
returns void language plpgsql security definer set search_path = '' as $$
declare v_app public.applications%rowtype;
begin
 if auth.uid() is null or not coalesce(public.is_application_final_approver(),false) then
  raise exception 'final_approver_required';
 end if;
 select * into v_app from public.applications where id=p_application_id for update;
 if not found or v_app.status <> 'approved' then raise exception 'approved_application_required'; end if;
 if not v_app.final_approval_required then raise exception 'final_confirmation_not_required'; end if;
 if v_app.final_confirmed_at is not null then raise exception 'already_final_confirmed'; end if;
 update public.applications set final_confirmed_at=now(),
 final_confirmed_by_employee_id=public.current_employee_id() where id=p_application_id;
end;
$$;

-- Called both before rendering and immediately before printing.
create or replace function public.assert_application_printable(p_application_id bigint)
returns void language plpgsql security definer set search_path = '' as $$
begin
 if auth.uid() is null or not coalesce(public.is_application_admin(),false) then raise exception 'admin_required'; end if;
 if not exists(select 1 from public.applications where id=p_application_id
 and status='approved' and (not final_approval_required or final_confirmed_at is not null)) then raise exception 'final_confirmation_required'; end if;
end;
$$;
create or replace function public.set_application_printed(p_application_id bigint,p_printed boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
 if auth.uid() is null or not coalesce(public.is_application_admin(),false) then raise exception 'admin_required'; end if;
 -- Lock serializes printing changes with approval cancellation/final confirmation.
 perform 1 from public.applications where id=p_application_id and status='approved' for update;
 if not found then raise exception 'approved_application_required'; end if;
 if p_printed then perform public.assert_application_printable(p_application_id); end if;
 update public.applications set printed_at=case when p_printed then now() else null end,
 printed_by_employee_id=case when p_printed then public.current_employee_id() else null end
 where id=p_application_id;
end;
$$;
revoke all on function public.guard_application_final_fields() from public,anon,authenticated;
revoke all on function public.is_application_final_approver() from public,anon,authenticated;
revoke all on function public.confirm_application_final(bigint) from public,anon,authenticated;
revoke all on function public.assert_application_printable(bigint) from public,anon,authenticated;
revoke all on function public.set_application_printed(bigint,boolean) from public,anon,authenticated;
grant execute on function public.is_application_final_approver() to authenticated;
grant execute on function public.confirm_application_final(bigint) to authenticated;
grant execute on function public.assert_application_printable(bigint) to authenticated;
grant execute on function public.set_application_printed(bigint,boolean) to authenticated;
notify pgrst,'reload schema';
commit;
