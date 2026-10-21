-- Review before production. Apply AFTER add_admin_paid_leave_usage_edit.sql.
-- Preserve existing usage/audit rows. The UUID suffix already survives edits.
begin;

-- Serialize the preflight/index/RPC replacement with existing writers.
lock table public.paid_leave_balance_transactions in share row exclusive mode;
do $$
begin
  if exists(select 1 from public.paid_leave_balance_transactions
    where application_id is null and transaction_type='application_usage'
      and source_key like 'admin_paid_usage:%'
      and source_key !~ '^admin_paid_usage:[0-9]{4}-[0-9]{2}-[0-9]{2}:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') then
    raise exception 'admin_paid_usage_invalid_request_identity: review legacy source keys before applying';
  end if;
  if exists(select 1 from public.paid_leave_balance_transactions
    where application_id is null and transaction_type='application_usage'
      and source_key like 'admin_paid_usage:%'
    group by split_part(source_key,':',3) having count(*)>1) then
    raise exception 'admin_paid_usage_duplicate_request_identity: review duplicate requests before applying';
  end if;
end;
$$;

-- Include inactive rows: deletion is a permanent tombstone for that UUID.
-- UUIDs identify requests globally, including across employees/fiscal years.
create unique index if not exists admin_paid_usage_request_uidx
  on public.paid_leave_balance_transactions((split_part(source_key,':',3)))
  where application_id is null and transaction_type='application_usage'
    and source_key like 'admin_paid_usage:%';

create or replace function public.register_admin_paid_leave_usage(
  p_employee_id bigint,p_usage_date date,p_days numeric,p_request_id uuid,p_note text default null)
returns public.paid_leave_balances
language plpgsql security definer set search_path = '' as $$
declare
  v_balance public.paid_leave_balances%rowtype;
  v_previous public.paid_leave_balance_transactions%rowtype;
  v_year integer;
begin
  if public.is_leave_manager() is distinct from true or public.current_employee_id() is null then
    raise exception '残数管理権限が必要です';
  end if;
  if p_usage_date is null or p_request_id is null or p_days is null
    or p_days::text in ('NaN','Infinity','-Infinity') or p_days<=0
    or p_days<>round(p_days,2) then
    raise exception '使用日と0より大きい使用日数（小数2桁まで）を入力してください';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('admin_paid_usage:'||p_request_id::text,0));
  -- Same balance-before-transaction lock order as edit/delete. Lock all years
  -- in ID order so replay serializes with fiscal transfers of this employee.
  perform 1 from public.paid_leave_balances where employee_id=p_employee_id order by id for update;
  select * into v_previous from public.paid_leave_balance_transactions
    where application_id is null and transaction_type='application_usage'
      and source_key like 'admin_paid_usage:%'
      and split_part(source_key,':',3)=p_request_id::text;
  if found then
    select * into v_balance from public.paid_leave_balances where id=v_previous.balance_id;
    if v_balance.employee_id is distinct from p_employee_id then
      raise exception '登録要求UUIDは別の対象社員に使用されています';
    end if;
    -- UUID is the immutable request identity. Never apply replayed payload,
    -- reactivate a tombstone, overwrite an edit, or append another audit row.
    return v_balance;
  end if;
  if not exists(select 1 from public.employees where id=p_employee_id and active=true) then
    raise exception '有効な対象社員を選択してください';
  end if;
  v_year:=extract(year from p_usage_date)::integer
    -case when extract(month from p_usage_date)<4 then 1 else 0 end;
  select * into v_balance from public.paid_leave_balances
    where employee_id=p_employee_id and fiscal_year=v_year for update;
  if not found then raise exception '使用日の年度の有給残数が未登録です'; end if;
  if v_balance.base_date is not null and p_usage_date<=v_balance.base_date then
    raise exception '経理取込基準日以前の使用は登録できません';
  end if;
  perform public.recalculate_paid_leave_balance(v_balance.id);
  select * into v_balance from public.paid_leave_balances where id=v_balance.id;
  if p_days>v_balance.remaining_days then raise exception '現在の有給残日数を超えています'; end if;
  insert into public.paid_leave_balance_transactions
    (balance_id,application_id,transaction_type,days,source_key,reason,created_by_employee_id)
  values(v_balance.id,null,'application_usage',-p_days,
    'admin_paid_usage:'||to_char(p_usage_date,'YYYY-MM-DD')||':'||p_request_id::text,
    nullif(trim(p_note),''),public.current_employee_id());
  perform public.recalculate_paid_leave_balance(v_balance.id);
  select * into v_balance from public.paid_leave_balances where id=v_balance.id;
  return v_balance;
end;
$$;
revoke all on function public.register_admin_paid_leave_usage(bigint,date,numeric,uuid,text) from public,anon,authenticated;
grant execute on function public.register_admin_paid_leave_usage(bigint,date,numeric,uuid,text) to authenticated;
notify pgrst,'reload schema';
commit;
