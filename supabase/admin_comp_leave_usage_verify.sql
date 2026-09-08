-- Test DB only. Requires a balance manager and an active employee with no holiday work rows.
-- All data changes roll back; identity sequences may advance.
begin;
do $$
declare v_auth uuid; v_employee bigint; v_first bigint; v_second bigint; v_cancelled bigint;
  v_app bigint; v_request uuid:=gen_random_uuid(); v_row public.holiday_work_records%rowtype;
begin
  select auth_user_id into strict v_auth from public.employees
    where active and is_leave_manager and auth_user_id is not null order by id limit 1;
  select e.id into strict v_employee from public.employees e where e.active
    and not exists(select 1 from public.holiday_work_records h where h.employee_id=e.id)
    order by e.id limit 1;
  perform set_config('request.jwt.claim.sub',v_auth::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',v_auth,'role','authenticated')::text,true);
  set local role authenticated;
  v_first:=public.register_holiday_work(v_employee,'2026-07-04',1,null,null,'manual',null);
  v_second:=public.register_holiday_work(v_employee,'2026-07-11',1,null,null,'manual',null);
  v_cancelled:=public.register_holiday_work(v_employee,'2026-07-01',5,null,null,'manual',null);
  perform public.cancel_holiday_work(v_cancelled,'テスト');
  v_app:=public.register_admin_comp_leave_usage(v_employee,'2026-08-01',1.5,v_request,'FIFOテスト');
  select * into v_row from public.holiday_work_records where id=v_first;
  if v_row.used_days<>1 or v_row.remaining_days<>0 then raise exception 'FAIL: first FIFO'; end if;
  select * into v_row from public.holiday_work_records where id=v_second;
  if v_row.used_days<>0.5 or v_row.remaining_days<>0.5 then raise exception 'FAIL: second FIFO'; end if;
  if public.register_admin_comp_leave_usage(v_employee,'2026-08-01',1.5,v_request,'FIFOテスト')<>v_app then
    raise exception 'FAIL: retry';
  end if;
  if not exists(select 1 from public.admin_comp_leave_usage_history(v_employee)
    where id=v_app and days=1.5 and usage_date='2026-08-01' and note='FIFOテスト'
      and created_by_employee_id=public.current_employee_id() and created_at is not null) then
    raise exception 'FAIL: history';
  end if;
  begin
    perform public.register_admin_comp_leave_usage(v_employee,'2026-08-02',1,gen_random_uuid());
    raise exception 'FAIL: overdraft';
  exception when raise_exception then if sqlerrm<>'現在の代休残日数を超えています' then raise; end if; end;
  begin
    perform public.cancel_holiday_work(v_first,'使用済み');
    raise exception 'FAIL: cancel used record';
  exception when raise_exception then
    if sqlerrm<>'holiday_work_allocated_to_submitted_or_approved_application_cannot_cancel' then raise; end if;
  end;
  begin
    perform public.update_holiday_work(v_first,'2026-07-04',0.5,null,null);
    raise exception 'FAIL: decrease below direct usage';
  exception when raise_exception then
    if sqlerrm<>'earned_days_cannot_be_less_than_submitted_or_approved_comp_leave_allocation' then raise; end if;
  end;
  reset role;
  perform public.recalculate_holiday_work_record(v_first);
  select * into v_row from public.holiday_work_records where id=v_first;
  if v_row.remaining_days<>0 then raise exception 'FAIL: existing recalculation'; end if;
  if exists(select 1 from public.comp_leave_allocations where application_id=v_app and holiday_work_record_id=v_cancelled) then
    raise exception 'FAIL: cancelled allocation';
  end if;
  perform set_config('request.jwt.claim.sub','',true);
  perform set_config('request.jwt.claims','{}',true);
  set local role authenticated;
  begin
    perform public.register_admin_comp_leave_usage(v_employee,'2026-08-02',0.5,gen_random_uuid());
    raise exception 'FAIL: permission';
  exception when raise_exception then if sqlerrm<>'残数管理権限が必要です' then raise; end if; end;
  reset role;
end;
$$;
rollback;
