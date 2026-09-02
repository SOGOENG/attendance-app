-- 各種申請基盤 ロールバックSQL
-- WARNING: 各種申請データをすべて削除します。適用前にバックアップしてください。
begin;

drop function if exists public.register_holiday_work(bigint,date,numeric,bigint,text,text,bigint);
drop function if exists public.update_holiday_work(bigint,date,numeric,bigint,text);
drop function if exists public.cancel_holiday_work(bigint,text);
drop function if exists public.set_paid_leave_opening_balance(bigint,integer,numeric,numeric,numeric,numeric,date);
drop function if exists public.cancel_application(bigint,text);
drop function if exists public.review_application(bigint,text,text);
drop function if exists public.delete_draft_application(bigint);
drop function if exists public.reopen_application_draft(bigint);
drop function if exists public.submit_application(bigint);
drop function if exists public.recalculate_holiday_work_record(bigint);
drop function if exists public.recalculate_paid_leave_balance(bigint);
drop function if exists public.validate_paid_leave_application(bigint);

drop table if exists public.comp_leave_allocations;
drop table if exists public.comp_leave_dates;
drop table if exists public.holiday_work_records;
drop table if exists public.paid_leave_balance_transactions;
drop table if exists public.paid_leave_balances;
drop table if exists public.comp_leave_application_details;
drop table if exists public.paid_leave_application_details;
drop table if exists public.application_status_history;
drop table if exists public.applications;
drop table if exists public.application_types;

drop function if exists public.set_application_actor();
drop function if exists public.set_application_updated_at();
drop function if exists public.is_application_admin();
drop function if exists public.current_employee_id();

commit;
