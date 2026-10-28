-- Review-only: requires approved_remaining_days to have been added first.
-- Preserve the guard function; stop if the expected trigger configuration differs.
begin;

lock table public.paid_leave_application_details in share row exclusive mode;

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
      and tgconstraint = 0
  ) then raise exception 'unexpected_driving_guard_trigger'; end if;

  if not exists (
    select 1 from pg_trigger
    where tgrelid = v_table and tgname = 'paid_leave_details_updated_at'
      and not tgisinternal and tgtype = 19 and tgenabled = 'O'
      and tgfoid = to_regprocedure('public.set_application_updated_at()')
      and tgqual is null and tgnargs = 0 and tgconstraint = 0
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

commit;
