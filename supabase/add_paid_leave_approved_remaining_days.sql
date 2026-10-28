-- Review only. Based on the production review_application definition supplied by the user.
-- Apply only after verifying the production function and privileges are still unchanged.
-- No backfill. The transaction fails if client roles can write the new column.
begin;

alter table public.paid_leave_application_details
  add column approved_remaining_days numeric(7,2);

do $privilege_check$
begin
  if has_column_privilege('anon', 'public.paid_leave_application_details', 'approved_remaining_days', 'INSERT')
     or has_column_privilege('anon', 'public.paid_leave_application_details', 'approved_remaining_days', 'UPDATE')
     or has_column_privilege('authenticated', 'public.paid_leave_application_details', 'approved_remaining_days', 'INSERT')
     or has_column_privilege('authenticated', 'public.paid_leave_application_details', 'approved_remaining_days', 'UPDATE') then
    raise exception 'approved_remaining_days_client_write_privilege: review table, column, PUBLIC and inherited grants';
  end if;
end;
$privilege_check$;

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

    -- Record the actual balance immediately after this approval's deduction.
    update public.paid_leave_application_details
    set approved_remaining_days = (
      select b.remaining_days
      from public.paid_leave_balances b
      where b.id = v_balance_id
    )
    where application_id = v_app.id;

    if not found then
      raise exception 'paid_leave_detail_required';
    end if;


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

notify pgrst, 'reload schema';
commit;
