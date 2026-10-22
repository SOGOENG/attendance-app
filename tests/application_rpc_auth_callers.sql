-- Reviewed production caller definitions/ACLs, 2026-10-22; test DB only.
CREATE OR REPLACE FUNCTION public.register_admin_paid_leave_usage(p_employee_id bigint, p_usage_date date, p_days numeric, p_request_id uuid, p_note text DEFAULT NULL::text)
 RETURNS paid_leave_balances
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$;
revoke all on function public.register_admin_paid_leave_usage(bigint,date,numeric,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.register_admin_paid_leave_usage(bigint,date,numeric,uuid,text) to authenticated;
grant execute on function public.register_admin_paid_leave_usage(bigint,date,numeric,uuid,text) to service_role;
CREATE OR REPLACE FUNCTION public.modify_admin_paid_leave_usage_internal(p_transaction_id bigint, p_employee_id bigint, p_delete boolean, p_usage_date date, p_days numeric, p_note text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$;
revoke all on function public.modify_admin_paid_leave_usage_internal(bigint,bigint,boolean,date,numeric,text) from public,anon,authenticated,service_role;
grant execute on function public.modify_admin_paid_leave_usage_internal(bigint,bigint,boolean,date,numeric,text) to service_role;
CREATE OR REPLACE FUNCTION public.update_admin_paid_leave_usage(p_transaction_id bigint, p_employee_id bigint, p_usage_date date, p_days numeric, p_note text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform public.modify_admin_paid_leave_usage_internal(p_transaction_id,p_employee_id,false,p_usage_date,p_days,p_note);
end;
$function$;
revoke all on function public.update_admin_paid_leave_usage(bigint,bigint,date,numeric,text) from public,anon,authenticated,service_role;
grant execute on function public.update_admin_paid_leave_usage(bigint,bigint,date,numeric,text) to authenticated;
grant execute on function public.update_admin_paid_leave_usage(bigint,bigint,date,numeric,text) to service_role;
CREATE OR REPLACE FUNCTION public.delete_admin_paid_leave_usage(p_transaction_id bigint, p_employee_id bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform public.modify_admin_paid_leave_usage_internal(p_transaction_id,p_employee_id,true,null,null,null);
end;
$function$;
revoke all on function public.delete_admin_paid_leave_usage(bigint,bigint) from public,anon,authenticated,service_role;
grant execute on function public.delete_admin_paid_leave_usage(bigint,bigint) to authenticated;
grant execute on function public.delete_admin_paid_leave_usage(bigint,bigint) to service_role;
CREATE OR REPLACE FUNCTION public.review_application(p_application_id bigint, p_decision text, p_comment text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare

  v_app public.applications%rowtype;

  v_admin bigint;

  v_detail
    public.paid_leave_application_details%rowtype;

  v_fiscal_year integer;

  v_balance_id bigint;

  v_record_id bigint;

  v_leave_days numeric(6,2);

  v_allocated_days numeric(6,2);

begin

  if not public.is_application_admin()
  then
    raise exception 'admin_required';
  end if;


  if p_decision not in (
    'approved',
    'rejected',
    'revision_required'
  )
  then
    raise exception 'invalid_decision';
  end if;


  v_admin :=
    public.current_employee_id();


  select *
  into v_app

  from public.applications

  where id =
    p_application_id

  for update;


  if not found then
    raise exception
      'application_not_found';
  end if;


  if v_app.status <> 'submitted'
  then
    raise exception
      'application_not_submitted';
  end if;


  if p_decision = 'approved'

     and v_app.application_type =
         'paid_leave'

  then


    perform
      public.validate_paid_leave_application(
        v_app.id
      );


    select *
    into v_detail

    from public.paid_leave_application_details

    where application_id =
      v_app.id;


    if not found then
      raise exception
        'paid_leave_detail_required';
    end if;


    v_fiscal_year :=
      extract(
        year
        from v_detail.start_date
      )::integer

      -

      case
        when extract(
          month
          from v_detail.start_date
        ) < 4
        then 1
        else 0
      end;


    select id
    into v_balance_id

    from public.paid_leave_balances

    where employee_id =
      v_app.employee_id

      and fiscal_year =
        v_fiscal_year

    for update;


    if not found then
      raise exception
        'paid_leave_balance_not_found';
    end if;


    if exists (

      select 1

      from public.paid_leave_balances b

      where b.id =
        v_balance_id

        and b.base_date
          is not null

        and v_detail.start_date
          <= b.base_date

    )
    then
      raise exception
        'paid_leave_date_already_in_imported_period';
    end if;


    insert into
      public.paid_leave_balance_transactions
    (
      balance_id,
      application_id,
      transaction_type,
      days,
      source_key,
      created_by_employee_id
    )

    values
    (
      v_balance_id,
      v_app.id,
      'application_usage',
      -v_detail.days,
      'application:'
        || v_app.id::text,
      v_admin
    )

    on conflict (
      balance_id,
      source_key
    )

    do update

    set
      days =
        excluded.days,

      active =
        true;

  end if;


  if p_decision = 'approved'

     and v_app.application_type =
         'comp_leave'

  then


    select
      coalesce(sum(days),0)

    into v_leave_days

    from public.comp_leave_dates

    where application_id =
      v_app.id;


    select
      coalesce(
        sum(allocated_days),
        0
      )

    into v_allocated_days

    from public.comp_leave_allocations

    where application_id =
      v_app.id;


    if v_leave_days <= 0 then
      raise exception
        'comp_leave_date_required';
    end if;


    if v_leave_days <>
       v_allocated_days
    then
      raise exception
        'comp_leave_allocation_mismatch';
    end if;


    if exists (

      select 1

      from public.comp_leave_allocations ca

      left join
        public.holiday_work_records h

        on h.id =
          ca.holiday_work_record_id

       and h.employee_id =
          v_app.employee_id

       and h.status =
          'active'

      where ca.application_id =
        v_app.id

        and h.id is null

    )
    then
      raise exception
        'invalid_or_cancelled_holiday_work_record';
    end if;


    for v_record_id in

      select h.id

      from public.holiday_work_records h

      join public.comp_leave_allocations ca

        on ca.holiday_work_record_id =
           h.id

      where ca.application_id =
        v_app.id

        and h.employee_id =
          v_app.employee_id

        and h.status =
          'active'

      order by h.id

      for update of h

    loop
      null;
    end loop;


    if not exists (

      select 1

      from public.comp_leave_allocations

      where application_id =
        v_app.id

    )
    then
      raise exception
        'comp_leave_allocation_required';
    end if;


    if not
      public.comp_leave_dates_within_expiry(
        v_app.id
      )
    then
      raise exception
        'comp_leave_date_exceeds_expiration';
    end if;

  end if;


  update public.applications

  set
    status =
      p_decision,

    reviewer_comment =
      nullif(trim(p_comment),''),

    approved_at =
      case
        when p_decision =
          'approved'
        then now()
        else null
      end,

    approved_by_employee_id =
      case
        when p_decision =
          'approved'
        then v_admin
        else null
      end,

    rejected_at =
      case
        when p_decision =
          'rejected'
        then now()
        else null
      end,

    rejected_by_employee_id =
      case
        when p_decision =
          'rejected'
        then v_admin
        else null
      end

  where id =
    v_app.id;


  if p_decision = 'approved'

     and v_app.application_type =
         'paid_leave'

  then

    perform
      public.recalculate_paid_leave_balance(
        v_balance_id
      );


  elsif p_decision = 'approved'

        and v_app.application_type =
            'comp_leave'

  then


    for v_record_id in

      select holiday_work_record_id

      from public.comp_leave_allocations

      where application_id =
        v_app.id

      order by
        holiday_work_record_id

    loop

      perform
        public.recalculate_holiday_work_record(
          v_record_id
        );

    end loop;

  end if;


  insert into
    public.application_status_history
  (
    application_id,
    from_status,
    to_status,
    comment,
    changed_by_employee_id
  )

  values
  (
    v_app.id,
    v_app.status,
    p_decision,
    nullif(trim(p_comment),''),
    v_admin
  );

end;
$function$;
revoke all on function public.review_application(bigint,text,text) from public,anon,authenticated,service_role;
grant execute on function public.review_application(bigint,text,text) to authenticated;
grant execute on function public.review_application(bigint,text,text) to service_role;
