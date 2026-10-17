-- 準備のみ。本番未実行。create_driving_report_tables.sql・add_employee_default_vehicle.sql 適用後、DB ownerで実行。
-- RLS・既存RPC・日報データ・列は変更しない。
begin;

-- 車両の引き継ぎに必要な数値だけを公開する。社員名・日報ID等は返さない。
create function public.previous_vehicle_end_odometer(p_vehicle_id bigint, p_report_date date)
returns numeric
language plpgsql stable security definer set search_path = '' as $$
declare
  v_actor bigint := public.current_employee_id();
  v_date date;
  v_value numeric;
begin
  if auth.uid() is null or v_actor is null then
    raise exception 'active_employee_required';
  end if;
  if p_report_date is null or p_report_date > (statement_timestamp() at time zone 'Asia/Tokyo')::date then
    raise exception 'invalid_report_date';
  end if;
  if p_vehicle_id is null or not exists (
    select 1 from public.vehicles where id=p_vehicle_id and active
  ) then
    return null;
  end if;

  -- 利用資格の判定にのみ社員IDを使う。取得値の検索は車両単位。
  -- 日報の社員IDはJWT由来のcurrent_employee_id()で確定し、引数では受け取らない。
  -- 選択しただけの車両・未来日報は資格にならない。通常車両以外の初回は手入力。
  if not exists (
    select 1 from public.employees
    where id=v_actor and auth_user_id=auth.uid() and active and default_vehicle_id=p_vehicle_id
  ) and not exists (
    select 1 from public.driving_reports
    where employee_id=v_actor and vehicle_id=p_vehicle_id
      and driving_status='driven' and report_date<=p_report_date
  ) then
    raise exception using errcode='42501', message='vehicle_odometer_access_denied';
  end if;

  select max(report_date) into v_date from public.driving_reports
  where vehicle_id=p_vehicle_id and report_date<p_report_date
    and driving_status='driven' and end_odometer is not null;

  -- 同じ最新日に複数社員の異なる値があると順序を確定できないため推測しない。
  select case when count(distinct end_odometer)=1 then max(end_odometer) else null end
    into v_value from public.driving_reports
    where vehicle_id=p_vehicle_id and report_date=v_date
      and driving_status='driven' and end_odometer is not null;
  return v_value;
end;
$$;

revoke all on function public.previous_vehicle_end_odometer(bigint,date) from public,anon,authenticated;
grant execute on function public.previous_vehicle_end_odometer(bigint,date) to authenticated;
commit;
