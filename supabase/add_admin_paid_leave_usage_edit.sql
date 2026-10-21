-- Apply after add_admin_paid_leave_usage.sql and leave_manager_balance_permissions.sql.
-- Review before production deployment. Reuses inactive zero-day adjustments for audit.
begin;

create or replace function public.modify_admin_paid_leave_usage_internal(
  p_transaction_id bigint, p_employee_id bigint, p_delete boolean,
  p_usage_date date, p_days numeric, p_note text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_old public.paid_leave_balance_transactions%rowtype;
  v_target public.paid_leave_balances%rowtype;
  v_actor bigint := public.current_employee_id();
  v_year integer;
  v_source_balance bigint;
begin
  if public.is_leave_manager() is distinct from true or v_actor is null then
    raise exception '残数管理権限が必要です';
  end if;
  if not p_delete and (p_usage_date is null or p_days is null or p_days<=0
    or p_days::text in ('NaN','Infinity','-Infinity')
    or p_days<>round(p_days,2) or p_days>9999.99) then
    raise exception '使用日と0より大きい使用日数（小数2桁まで）を入力してください';
  end if;
  -- All operations lock balances before transactions, matching registration/approval.
  -- Lock employee balances in ID order, including fiscal-year moves.
  perform 1 from public.paid_leave_balances where employee_id=p_employee_id order by id for update;
  select t.* into v_old from public.paid_leave_balance_transactions t
    join public.paid_leave_balances b on b.id=t.balance_id
    where t.id=p_transaction_id and b.employee_id=p_employee_id for update of t;
  if not found or not v_old.active or v_old.application_id is not null
    or v_old.transaction_type<>'application_usage' or v_old.days>=0
    or v_old.source_key !~ '^admin_paid_usage:[0-9]{4}-[0-9]{2}-[0-9]{2}:[0-9a-f-]{36}$' then
    raise exception '有効な管理者直接登録履歴ではありません';
  end if;
  v_source_balance:=v_old.balance_id;
  if p_delete then
    update public.paid_leave_balance_transactions set active=false where id=v_old.id;
  else
    v_year:=extract(year from p_usage_date)::integer
      -case when extract(month from p_usage_date)<4 then 1 else 0 end;
    select * into v_target from public.paid_leave_balances
      where employee_id=p_employee_id and fiscal_year=v_year;
    if not found then raise exception '使用日の年度の有給残数が未登録です'; end if;
    if v_target.base_date is not null and p_usage_date<=v_target.base_date then
      raise exception '経理取込基準日以前の使用は登録できません';
    end if;
    update public.paid_leave_balance_transactions set balance_id=v_target.id,
      days=-p_days,reason=nullif(trim(p_note),''),
      source_key='admin_paid_usage:'||to_char(p_usage_date,'YYYY-MM-DD')||':'||split_part(v_old.source_key,':',3)
      where id=v_old.id;
  end if;
  -- Existing recalculation rejects negative balances; any failure rolls everything back.
  perform public.recalculate_paid_leave_balance(v_source_balance);
  if not p_delete and v_target.id<>v_source_balance then
    perform public.recalculate_paid_leave_balance(v_target.id);
  end if;
  insert into public.paid_leave_balance_transactions
    (balance_id,application_id,transaction_type,days,source_key,active,reason,created_by_employee_id)
  values(v_source_balance,null,'adjustment',0,
    'admin_paid_usage_audit:'||v_old.id::text||':'||pg_catalog.gen_random_uuid()::text,false,
    pg_catalog.jsonb_build_object('operation',case when p_delete then 'delete' else 'update' end,
      'transaction_id',v_old.id,'before',pg_catalog.to_jsonb(v_old),
      'after',(select pg_catalog.to_jsonb(t) from public.paid_leave_balance_transactions t where t.id=v_old.id))::text,
    v_actor);
end;
$$;

create or replace function public.update_admin_paid_leave_usage(
  p_transaction_id bigint,p_employee_id bigint,p_usage_date date,p_days numeric,p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public.modify_admin_paid_leave_usage_internal(p_transaction_id,p_employee_id,false,p_usage_date,p_days,p_note);
end;
$$;
create or replace function public.delete_admin_paid_leave_usage(p_transaction_id bigint,p_employee_id bigint)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public.modify_admin_paid_leave_usage_internal(p_transaction_id,p_employee_id,true,null,null,null);
end;
$$;
revoke all on function public.modify_admin_paid_leave_usage_internal(bigint,bigint,boolean,date,numeric,text) from public,anon,authenticated;
revoke all on function public.update_admin_paid_leave_usage(bigint,bigint,date,numeric,text) from public,anon,authenticated;
revoke all on function public.delete_admin_paid_leave_usage(bigint,bigint) from public,anon,authenticated;
grant execute on function public.update_admin_paid_leave_usage(bigint,bigint,date,numeric,text) to authenticated;
grant execute on function public.delete_admin_paid_leave_usage(bigint,bigint) to authenticated;
notify pgrst,'reload schema';
commit;
