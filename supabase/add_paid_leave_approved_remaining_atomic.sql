-- Review-only. One transaction; no production application or backfill performed.
-- The review_application MD5 is the production value supplied by the user.
begin;

lock table public.paid_leave_application_details in access exclusive mode;

do $review_definition_check$
declare
  v_review regprocedure := to_regprocedure('public.review_application(bigint,text,text)');
begin
  if v_review is null then raise exception 'review_application_not_found'; end if;
  if md5(pg_get_functiondef(v_review)) <> '6b7a94ffc7a47cb292073c2d5a6847d8' then
    raise exception 'review_application_definition_md5_mismatch';
  end if;
end;
$review_definition_check$;

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

-- Confirm that the later BEFORE UPDATE trigger only sets updated_at.
do $updated_at_check$
declare
  v_updated_at regprocedure := to_regprocedure('public.set_application_updated_at()');
  v_body text;
begin
  if v_updated_at is null then raise exception 'updated_at_function_not_found'; end if;
  select prosrc into v_body from pg_proc where oid = v_updated_at;
  if v_body !~* '^[[:space:]]*begin[[:space:]]+new[.]updated_at[[:space:]]*:=[[:space:]]*now[(][)][[:space:]]*;[[:space:]]*return[[:space:]]+new[[:space:]]*;[[:space:]]*end[[:space:]]*;[[:space:]]*$' then
    raise exception 'updated_at_function_body_review_required';
  end if;
end;
$updated_at_check$;

do $check$
declare
  v_table regclass := 'public.paid_leave_application_details'::regclass;
  v_guard regprocedure := to_regprocedure('public.driving_month_source_guard()');
begin
  if v_guard is null then raise exception 'driving_month_source_guard_not_found'; end if;
  if not exists (
    select 1 from pg_attribute
    where attrelid = v_table and attname = 'approved_remaining_days'
      and not attisdropped and atttypid = 'numeric'::regtype
      and atttypmod = 458758
  ) then raise exception 'approved_remaining_days_numeric_7_2_required'; end if;

  -- Row-level BEFORE INSERT OR DELETE OR UPDATE, enabled normally, no WHEN or args.
  if not exists (
    select 1 from pg_trigger
    where tgrelid = v_table and tgname = 'a_driving_month_source'
      and not tgisinternal and tgtype = 31 and tgenabled = 'O'
      and tgfoid = v_guard and tgqual is null and tgnargs = 0
      and tgconstraint = 0 and tgattr::text = ''
  ) then raise exception 'unexpected_driving_guard_trigger'; end if;

  if not exists (
    select 1 from pg_trigger
    where tgrelid = v_table and tgname = 'paid_leave_details_updated_at'
      and not tgisinternal and tgtype = 19 and tgenabled = 'O'
      and tgfoid = to_regprocedure('public.set_application_updated_at()')
      and tgqual is null and tgnargs = 0 and tgconstraint = 0 and tgattr::text = ''
  ) then raise exception 'unexpected_updated_at_trigger'; end if;

  -- No other row-level BEFORE UPDATE trigger may alter the row before or after
  -- this guard; review any additional trigger instead of weakening the guard.
  if exists (
    select 1 from pg_trigger
    where tgrelid = v_table and not tgisinternal and tgenabled <> 'D'
      and (tgtype & 1) <> 0 and (tgtype & 2) <> 0 and (tgtype & 16) <> 0
      and tgname not in ('a_driving_month_source', 'paid_leave_details_updated_at')
  ) then raise exception 'unexpected_before_update_trigger'; end if;

  if exists (select 1 from pg_trigger where tgrelid = v_table
      and tgname = 'a_driving_month_source_update' and not tgisinternal) then
    raise exception 'update_guard_trigger_already_exists';
  end if;
  -- The UPDATE trigger has a new name. A guard that uses TG_NAME requires review.
  if pg_get_functiondef(v_guard) ~* '\mTG_NAME\M' then
    raise exception 'guard_depends_on_trigger_name_review_required';
  end if;
end;
$check$;

drop trigger a_driving_month_source on public.paid_leave_application_details;

create trigger a_driving_month_source
  before insert or delete on public.paid_leave_application_details
  for each row execute function public.driving_month_source_guard();

create trigger a_driving_month_source_update
  before update on public.paid_leave_application_details
  for each row
  when (
    old.approved_remaining_days is not distinct from new.approved_remaining_days
    or (to_jsonb(old) - 'approved_remaining_days')
       is distinct from (to_jsonb(new) - 'approved_remaining_days')
  )
  execute function public.driving_month_source_guard();

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
