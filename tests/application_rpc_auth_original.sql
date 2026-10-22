-- Reviewed production definitions (2026-10-22), normalized LF. Fictional-data test fixture only.
CREATE OR REPLACE FUNCTION public.cancel_application(p_application_id bigint, p_comment text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_app public.applications%rowtype;
  v_actor bigint;
  v_balance_id bigint;
  v_record_id bigint;
begin
  v_actor := public.current_employee_id();
  select * into v_app from public.applications
  where id = p_application_id for update;
  if not found then raise exception 'application_not_found'; end if;

  if v_app.status = 'cancelled' then return; end if;
  if not public.is_application_admin() then
    if v_app.employee_id <> v_actor then raise exception 'forbidden'; end if;
    if v_app.status not in ('draft', 'submitted', 'revision_required') then
      raise exception 'admin_required_to_cancel_approved_application';
    end if;
  end if;

  if v_app.status = 'approved' and v_app.application_type = 'paid_leave' then
    select balance_id into v_balance_id
    from public.paid_leave_balance_transactions
    where application_id = v_app.id and transaction_type = 'application_usage'
    for update;
    update public.paid_leave_balance_transactions
      set active = false
      where application_id = v_app.id and transaction_type = 'application_usage';
  elsif v_app.status = 'approved' and v_app.application_type = 'comp_leave' then
    perform 1 from public.holiday_work_records h
    where h.id in (select holiday_work_record_id from public.comp_leave_allocations
      where application_id = v_app.id)
    order by h.id for update;
  end if;

  update public.applications
  set status = 'cancelled', reviewer_comment = coalesce(nullif(trim(p_comment), ''), reviewer_comment),
      approved_at = null, approved_by_employee_id = null,
      rejected_at = null, rejected_by_employee_id = null
  where id = v_app.id;

  if v_balance_id is not null then
    perform public.recalculate_paid_leave_balance(v_balance_id);
  end if;
  if v_app.status = 'approved' and v_app.application_type = 'comp_leave' then
    for v_record_id in select holiday_work_record_id from public.comp_leave_allocations
      where application_id = v_app.id order by holiday_work_record_id
    loop
      perform public.recalculate_holiday_work_record(v_record_id);
    end loop;
  end if;

  insert into public.application_status_history
    (application_id, from_status, to_status, comment, changed_by_employee_id)
  values (v_app.id, v_app.status, 'cancelled', nullif(trim(p_comment), ''), v_actor);
end;
$function$;

CREATE OR REPLACE FUNCTION public.reopen_application_draft(p_application_id bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_app public.applications%rowtype;
begin
  select * into v_app from public.applications
  where id = p_application_id for update;
  if not found then raise exception 'application_not_found'; end if;
  if v_app.employee_id <> public.current_employee_id() then raise exception 'forbidden'; end if;
  if v_app.status <> 'revision_required' then raise exception 'application_not_revision_required'; end if;

  update public.applications set status = 'draft' where id = v_app.id;
  insert into public.application_status_history
    (application_id, from_status, to_status, changed_by_employee_id)
  values (v_app.id, v_app.status, 'draft', public.current_employee_id());
end;
$function$;

CREATE OR REPLACE FUNCTION public.recalculate_paid_leave_balance(p_balance_id bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_balance public.paid_leave_balances%rowtype;
  v_granted numeric(7,2);
  v_carried numeric(7,2);
  v_imported_used numeric(7,2);
  v_application_used numeric(7,2);
  v_adjustment numeric(7,2);
  v_remaining numeric(7,2);
begin
  select * into v_balance
  from public.paid_leave_balances
  where id = p_balance_id
  for update;

  if not found then raise exception 'paid_leave_balance_not_found'; end if;

  select
    coalesce(sum(days) filter (where transaction_type = 'grant' and active), 0),
    coalesce(sum(days) filter (where transaction_type = 'carryover' and active), 0),
    coalesce(-sum(days) filter (where transaction_type = 'imported_usage' and active), 0),
    coalesce(-sum(days) filter (where transaction_type = 'application_usage' and active), 0),
    coalesce(sum(days) filter (where transaction_type = 'adjustment' and active), 0),
    coalesce(sum(days) filter (where active), 0)
  into v_granted, v_carried, v_imported_used,
       v_application_used, v_adjustment, v_remaining
  from public.paid_leave_balance_transactions
  where balance_id = p_balance_id;

  if v_remaining < 0 then raise exception 'insufficient_paid_leave_balance'; end if;

  update public.paid_leave_balances
  set granted_days = v_granted,
      carried_days = v_carried,
      imported_used_days = v_imported_used,
      adjustment_days = v_adjustment,
      used_days = v_imported_used + v_application_used,
      remaining_days = v_remaining,
      updated_by_employee_id = public.current_employee_id()
  where id = p_balance_id;
end;
$function$;


revoke all on function public.cancel_application(bigint,text) from public,anon,authenticated,service_role;
grant execute on function public.cancel_application(bigint,text) to anon,authenticated,service_role;
revoke all on function public.reopen_application_draft(bigint) from public,anon,authenticated,service_role;
grant execute on function public.reopen_application_draft(bigint) to anon,authenticated,service_role;
revoke all on function public.recalculate_paid_leave_balance(bigint) from public,anon,authenticated,service_role;
grant execute on function public.recalculate_paid_leave_balance(bigint) to anon,authenticated,service_role;
