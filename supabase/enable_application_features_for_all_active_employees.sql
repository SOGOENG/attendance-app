-- 有効な全社員に申請機能を公開する。既存DBにはこのファイルだけを実行する。
create or replace function public.can_use_application_features()
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
  )
$$;

revoke all on function public.can_use_application_features() from public;
grant execute on function public.can_use_application_features() to authenticated;
