-- Test database only; requires an active balance manager and employee.
-- Execute after add_admin_paid_leave_usage.sql. All changes are rolled back.
begin;
do $$
declare v_auth uuid; v_employee bigint; v_balance public.paid_leave_balances%rowtype;
  v_request uuid := gen_random_uuid(); v_id bigint; v_count integer;
begin
  select auth_user_id into strict v_auth from public.employees
    where active and is_leave_manager and auth_user_id is not null order by id limit 1;
  select id into strict v_employee from public.employees where active order by id limit 1;
  perform set_config('request.jwt.claim.sub',v_auth::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',v_auth,'role','authenticated')::text,true);
  set local role authenticated;
  v_id := public.set_paid_leave_opening_balance(v_employee,2199,10,0,0,0,'2199-04-01');
  v_balance := public.register_admin_paid_leave_usage(v_employee,'2199-04-02',1.5,v_request,'テスト');
  if v_balance.used_days <> 1.5 or v_balance.remaining_days <> 8.5 then raise exception 'FAIL: recalculation'; end if;
  v_balance := public.register_admin_paid_leave_usage(v_employee,'2199-04-02',1.5,v_request,'テスト');
  if v_balance.remaining_days <> 8.5 then raise exception 'FAIL: retry duplicated'; end if;
  select count(*) into v_count from public.admin_paid_leave_usage_history(v_employee)
    where usage_date='2199-04-02' and days=1.5 and note='テスト'
      and created_by_employee_id=public.current_employee_id() and created_at is not null;
  if v_count<>1 then raise exception 'FAIL: history'; end if;
  begin
    perform public.register_admin_paid_leave_usage(v_employee,'2199-04-02',9,gen_random_uuid());
    raise exception 'FAIL: overdraft accepted';
  exception when raise_exception then if sqlerrm <> '現在の有給残日数を超えています' then raise; end if; end;
  begin
    perform public.register_admin_paid_leave_usage(v_employee,'2199-04-01',1,gen_random_uuid());
    raise exception 'FAIL: imported period accepted';
  exception when raise_exception then if sqlerrm <> '経理取込基準日以前の使用は登録できません' then raise; end if; end;
  begin
    perform public.register_admin_paid_leave_usage(v_employee,'2199-04-02',0,gen_random_uuid());
    raise exception 'FAIL: zero accepted';
  exception when raise_exception then if sqlerrm not like '使用日と0より%' then raise; end if; end;
  reset role;
  perform public.recalculate_paid_leave_balance(v_id);
  select * into v_balance from public.paid_leave_balances where id=v_id;
  if v_balance.remaining_days<>8.5 then raise exception 'FAIL: existing recalculator lost usage'; end if;
  perform set_config('request.jwt.claim.sub','',true);
  perform set_config('request.jwt.claims','{}',true);
  set local role authenticated;
  begin
    perform public.register_admin_paid_leave_usage(v_employee,'2199-04-02',1,gen_random_uuid());
    raise exception 'FAIL: unauthorized accepted';
  exception when raise_exception then if sqlerrm <> '残数管理権限が必要です' then raise; end if; end;
  reset role;
end;
$$;
rollback;
