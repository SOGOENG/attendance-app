-- Apply only after application_management.sql and leave_manager_balance_permissions.sql.
-- Review only: no new tables or changes to existing RLS/recalculation functions.
begin;

create or replace function public.register_admin_paid_leave_usage(
  p_employee_id bigint, p_usage_date date, p_days numeric,
  p_request_id uuid, p_note text default null)
returns public.paid_leave_balances
language plpgsql security definer set search_path = '' as $$
declare
  v_balance public.paid_leave_balances%rowtype;
  v_previous public.paid_leave_balance_transactions%rowtype;
  v_year integer;
  v_source text;
begin
  if not public.is_leave_manager() then raise exception '残数管理権限が必要です'; end if;
  if p_usage_date is null or p_request_id is null or p_days is null
    or p_days::text in ('NaN','Infinity','-Infinity') or p_days <= 0
    or p_days <> round(p_days,2) then
    raise exception '使用日と0より大きい使用日数（小数2桁まで）を入力してください';
  end if;
  if not exists (select 1 from public.employees where id=p_employee_id and active=true) then
    raise exception '有効な対象社員を選択してください';
  end if;
  v_year := extract(year from p_usage_date)::integer
    - case when extract(month from p_usage_date)<4 then 1 else 0 end;
  select * into v_balance from public.paid_leave_balances
    where employee_id=p_employee_id and fiscal_year=v_year for update;
  if not found then raise exception '使用日の年度の有給残数が未登録です'; end if;
  v_source := 'admin_paid_usage:' || to_char(p_usage_date,'YYYY-MM-DD') || ':' || p_request_id::text;
  select * into v_previous from public.paid_leave_balance_transactions
    where balance_id=v_balance.id and source_key=v_source;
  if found then
    if v_previous.days is distinct from -p_days
      or v_previous.reason is distinct from nullif(trim(p_note),'') then
      raise exception '同じ登録要求の内容が変更されています';
    end if;
    return v_balance;
  end if;
  if v_balance.base_date is not null and p_usage_date <= v_balance.base_date then
    raise exception '経理取込基準日以前の使用は登録できません';
  end if;
  perform public.recalculate_paid_leave_balance(v_balance.id);
  select * into v_balance from public.paid_leave_balances where id=v_balance.id;
  if p_days > v_balance.remaining_days then raise exception '現在の有給残日数を超えています'; end if;
  insert into public.paid_leave_balance_transactions
    (balance_id,application_id,transaction_type,days,source_key,reason,created_by_employee_id)
  values (v_balance.id,null,'application_usage',-p_days,v_source,
    nullif(trim(p_note),''),public.current_employee_id());
  perform public.recalculate_paid_leave_balance(v_balance.id);
  select * into v_balance from public.paid_leave_balances where id=v_balance.id;
  return v_balance;
end;
$$;

create or replace function public.admin_paid_leave_usage_history(p_employee_id bigint)
returns table(id bigint, employee_id bigint, usage_date date, days numeric,
  note text, created_by_employee_id bigint, created_at timestamptz, active boolean)
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_leave_manager() then raise exception '残数管理権限が必要です'; end if;
  return query select t.id,b.employee_id,split_part(t.source_key,':',2)::date,
    -t.days,t.reason,t.created_by_employee_id,t.created_at,t.active
  from public.paid_leave_balance_transactions t
  join public.paid_leave_balances b on b.id=t.balance_id
  where b.employee_id=p_employee_id and t.transaction_type='application_usage'
    and t.application_id is null and t.source_key like 'admin_paid_usage:%'
  order by t.created_at desc,t.id desc;
end;
$$;

revoke all on function public.register_admin_paid_leave_usage(bigint,date,numeric,uuid,text) from public,anon;
revoke all on function public.admin_paid_leave_usage_history(bigint) from public,anon;
grant execute on function public.register_admin_paid_leave_usage(bigint,date,numeric,uuid,text) to authenticated;
grant execute on function public.admin_paid_leave_usage_history(bigint) to authenticated;
notify pgrst, 'reload schema';
commit;
