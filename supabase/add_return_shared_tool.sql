-- Run as the trusted table owner (as with the existing SECURITY DEFINER RPCs).
-- Does not change tools/tool_history policies or table privileges.
begin;

create or replace function public.return_shared_tool(p_tool_id bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_employee public.employees%rowtype;
  v_tool public.tools%rowtype;
begin
  begin
    select * into strict v_employee
    from public.employees
    where auth_user_id = auth.uid() and active = true;
  exception
    when no_data_found or too_many_rows then
      raise exception 'ログイン中の有効な社員情報を確認できません';
  end;

  select * into v_tool
  from public.tools
  where id = p_tool_id
  for update;

  if not found then
    raise exception '工具情報が見つかりません';
  end if;
  if v_tool.ownership_type is distinct from 'shared'
     or v_tool.active is distinct from true
     or v_tool.checkout_managed is distinct from true then
    raise exception '返却対象の共有工具ではありません';
  end if;
  if v_tool.current_site_id is null then
    raise exception 'この工具は現在返却可能な使用中工具ではありません';
  end if;

  update public.tools
  set current_site_id = null,
      assigned_employee_id = null,
      status = 'available',
      updated_at = now()
  where id = v_tool.id;
  if not found then
    raise exception '工具の返却に失敗しました';
  end if;

  insert into public.tool_history (
    tool_id, action_type, from_site_id, to_site_id,
    from_employee_id, to_employee_id, operated_by_employee_id, note
  ) values (
    v_tool.id, 'return', v_tool.current_site_id, null,
    v_tool.assigned_employee_id, null, v_employee.id, null
  );
  if not found then
    raise exception '返却履歴の保存に失敗しました';
  end if;
  -- Do not catch mutation errors: either failure rolls back the whole RPC.
end;
$$;

revoke all on function public.return_shared_tool(bigint) from public, anon;
grant execute on function public.return_shared_tool(bigint) to authenticated;
notify pgrst, 'reload schema';
commit;
