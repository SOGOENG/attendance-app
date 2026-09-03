-- 本人の下書き申請だけを削除するRPCを追加します。
-- Supabase SQL Editorで、このファイル全体を実行してください。

begin;

create or replace function public.delete_draft_application(
  p_application_id bigint
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_app public.applications%rowtype;
  v_actor bigint;
begin
  -- current_employee_id()はauth.uid()とemployees.auth_user_idの対応から社員を特定します。
  v_actor := public.current_employee_id();

  if v_actor is null then
    raise exception 'employee_not_found';
  end if;

  select *
  into v_app
  from public.applications
  where id = p_application_id
  for update;

  if not found then
    raise exception 'application_not_found';
  end if;

  if v_app.employee_id <> v_actor then
    raise exception 'draft_application_owner_required';
  end if;

  if v_app.status <> 'draft' then
    raise exception 'application_not_draft';
  end if;

  -- paid/comp詳細、代休日、割当、状態履歴は既存FKのON DELETE CASCADEで削除されます。
  delete from public.applications
  where id = v_app.id;
end;
$$;

revoke all
on function public.delete_draft_application(bigint)
from public;

grant execute
on function public.delete_draft_application(bigint)
to authenticated;

commit;

-- PostgRESTのスキーマキャッシュを即時更新します。
notify pgrst, 'reload schema';
