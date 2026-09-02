-- 各種申請基盤 実行後確認SQL（データ変更なし）

-- 1. 作成オブジェクト
select table_name
from information_schema.tables
where table_schema = 'public'
  and table_name in (
    'application_types', 'applications', 'application_status_history',
    'paid_leave_application_details', 'comp_leave_application_details',
    'comp_leave_dates',
    'paid_leave_balances', 'paid_leave_balance_transactions',
    'holiday_work_records', 'comp_leave_allocations'
  )
order by table_name;

-- 2. RLSがすべて有効か
select relname as table_name, relrowsecurity as rls_enabled
from pg_class
where relnamespace = 'public'::regnamespace
  and relname in (
    'application_types', 'applications', 'application_status_history',
    'paid_leave_application_details', 'comp_leave_application_details',
    'comp_leave_dates',
    'paid_leave_balances', 'paid_leave_balance_transactions',
    'holiday_work_records', 'comp_leave_allocations'
  )
order by relname;

-- 3. Policy一覧
select tablename, policyname, roles, cmd, qual, with_check
from pg_policies
where schemaname = 'public'
  and tablename in (
    'application_types', 'applications', 'application_status_history',
    'paid_leave_application_details', 'comp_leave_application_details',
    'comp_leave_dates',
    'paid_leave_balances', 'paid_leave_balance_transactions',
    'holiday_work_records', 'comp_leave_allocations'
  )
order by tablename, policyname;

-- 4. RPC一覧とsecurity definer確認
select p.proname,
       p.prosecdef as security_definer,
       pg_get_function_identity_arguments(p.oid) as arguments
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'current_employee_id', 'is_application_admin',
    'submit_application', 'reopen_application_draft',
    'delete_draft_application',
    'review_application', 'cancel_application',
    'set_paid_leave_opening_balance', 'register_holiday_work',
    'update_holiday_work', 'cancel_holiday_work',
    'validate_paid_leave_application',
    'recalculate_paid_leave_balance', 'recalculate_holiday_work_record'
  )
order by p.proname;

-- 5. tool_adminが申請管理者判定へ含まれていないことを関数定義で確認
select pg_get_functiondef('public.is_application_admin()'::regprocedure);

-- 6. 初期申請種別
select code, display_name, category, detail_kind, active, display_order
from public.application_types
order by display_order;

-- 7. 残数整合性（結果0件が正常）
select id, employee_id, fiscal_year, remaining_days,
       granted_days + carried_days + adjustment_days - used_days as calculated
from public.paid_leave_balances
where remaining_days <>
      granted_days + carried_days + adjustment_days - used_days;

select id, employee_id, work_date, remaining_days,
       earned_days - used_days as calculated
from public.holiday_work_records
where remaining_days <> earned_days - used_days;

-- 8. 重複した有給申請使用行（結果0件が正常）
select application_id, count(*)
from public.paid_leave_balance_transactions
where transaction_type = 'application_usage'
group by application_id
having count(*) > 1;

-- 9. 認証済みユーザーで個別確認
select public.current_employee_id() as employee_id,
       public.is_application_admin() as is_application_admin;

-- 10. 年度をまたぐ有給詳細（結果0件が正常）
select application_id, start_date, end_date
from public.paid_leave_application_details
where extract(year from start_date)::integer
        - case when extract(month from start_date) < 4 then 1 else 0 end
   <> extract(year from end_date)::integer
        - case when extract(month from end_date) < 4 then 1 else 0 end;

-- 11. 有給日数の不整合（結果0件が正常）
select application_id, start_date, end_date, days, day_part
from public.paid_leave_application_details
where end_date < start_date
   or days <= 0
   or days > (end_date - start_date + 1)
   or (day_part in ('am', 'pm') and (start_date <> end_date or days <> 0.5))
   or (day_part = 'full' and days < 1);

-- 12. 代休日合計と休日出勤割当合計の不一致
-- draft編集中は不一致になり得るため、submitted/approvedだけ0件が正常です。
select a.id,
       coalesce(d.leave_days, 0) as leave_days,
       coalesce(x.allocated_days, 0) as allocated_days
from public.applications a
left join (
  select application_id, sum(days) as leave_days
  from public.comp_leave_dates group by application_id
) d on d.application_id = a.id
left join (
  select application_id, sum(allocated_days) as allocated_days
  from public.comp_leave_allocations group by application_id
) x on x.application_id = a.id
where a.application_type = 'comp_leave'
  and a.status in ('submitted', 'approved')
  and coalesce(d.leave_days, 0) <> coalesce(x.allocated_days, 0);

-- 13. 承認済み代休使用数との不整合（結果0件が正常）
select h.id, h.used_days, coalesce(x.approved_used, 0) as calculated_used
from public.holiday_work_records h
left join (
  select ca.holiday_work_record_id, sum(ca.allocated_days) as approved_used
  from public.comp_leave_allocations ca
  join public.applications a on a.id = ca.application_id
  where a.status = 'approved'
  group by ca.holiday_work_record_id
) x on x.holiday_work_record_id = h.id
where h.used_days <> coalesce(x.approved_used, 0);

-- 14. 経理取込基準日以前（同日を含む）の承認済み有給（結果0件が正常）
select a.id as application_id, d.start_date, d.end_date, b.base_date
from public.applications a
join public.paid_leave_application_details d on d.application_id = a.id
join public.paid_leave_balances b
  on b.employee_id = a.employee_id
 and b.fiscal_year = extract(year from d.start_date)::integer
   - case when extract(month from d.start_date) < 4 then 1 else 0 end
where a.status = 'approved'
  and b.base_date is not null
  and d.start_date <= b.base_date;

-- 15. submitted/approved割当が発生日数を超える休日出勤（結果0件が正常）
select h.id, h.earned_days, sum(ca.allocated_days) as committed_allocated_days
from public.holiday_work_records h
join public.comp_leave_allocations ca on ca.holiday_work_record_id = h.id
join public.applications a on a.id = ca.application_id
where a.status in ('submitted', 'approved')
group by h.id, h.earned_days
having sum(ca.allocated_days) > h.earned_days;

-- 16. 取消済みなのにsubmitted/approved申請から参照される休日出勤（結果0件が正常）
select distinct h.id, a.id as application_id, a.status
from public.holiday_work_records h
join public.comp_leave_allocations ca on ca.holiday_work_record_id = h.id
join public.applications a on a.id = ca.application_id
where h.status = 'cancelled'
  and a.status in ('submitted', 'approved');
