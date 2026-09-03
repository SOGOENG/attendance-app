-- 有給・代休残数管理を employees.is_leave_manager = true の社員に限定する。
-- Supabase SQL Editor で、このファイル全体を1回実行してください。

begin;

alter table public.employees
  add column if not exists is_leave_manager boolean not null default false;

create or replace function public.is_leave_manager()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.employees e
    where e.auth_user_id = auth.uid()
      and e.active = true
      and e.is_leave_manager = true
  )
$$;

-- 既存RPC本体は保持し、先頭の管理者判定だけを残数管理者判定へ置換する。
-- 対象関数や既存判定が見つからない場合は、変更せずエラーで終了する。
do $$
declare
  v_function regprocedure;
  v_definition text;
  v_old_guard constant text :=
    'if not public.is_application_admin() then raise exception ''admin_required''; end if;';
  v_new_guard constant text :=
    'if not public.is_leave_manager() then raise exception ''leave_manager_required''; end if;';
begin
  foreach v_function in array array[
    'public.set_paid_leave_opening_balance(bigint,integer,numeric,numeric,numeric,numeric,date)'::regprocedure,
    'public.register_holiday_work(bigint,date,numeric,bigint,text,text,bigint)'::regprocedure,
    'public.update_holiday_work(bigint,date,numeric,bigint,text)'::regprocedure,
    'public.cancel_holiday_work(bigint,text)'::regprocedure
  ]
  loop
    select pg_get_functiondef(v_function)
      into v_definition;

    if strpos(v_definition, v_old_guard) = 0 then
      raise exception 'Expected authorization guard was not found in %', v_function;
    end if;

    execute replace(v_definition, v_old_guard, v_new_guard);
  end loop;
end;
$$;

-- 残数テーブルへの直接書込みは禁止したままにし、上記RPCだけを更新経路にする。
revoke insert, update, delete, truncate
  on public.paid_leave_balances,
     public.paid_leave_balance_transactions,
     public.holiday_work_records
  from anon, authenticated;

-- 管理一覧の参照は本人・申請管理者に加え、残数管理者にも許可する。
-- 書込みPolicyは追加しないため、直接更新はできない。
alter policy paid_leave_balances_self_or_admin_select
on public.paid_leave_balances
using (
  employee_id = public.current_employee_id()
  or public.is_application_admin()
  or public.is_leave_manager()
);

alter policy holiday_work_records_self_or_admin_select
on public.holiday_work_records
using (
  employee_id = public.current_employee_id()
  or public.is_application_admin()
  or public.is_leave_manager()
);

revoke all on function public.is_leave_manager() from public;
grant execute on function public.is_leave_manager() to authenticated;

commit;

-- 実行確認（結果は true の社員が2名であること）
select id, name, admin_scope, is_leave_manager
from public.employees
where is_leave_manager = true
order by id;
