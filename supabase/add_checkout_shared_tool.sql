-- Apply as the trusted table owner BEFORE deploying tool-checkout.js v5.
-- Existing RLS, table grants, return/move operations and existing rows are unchanged.
begin;

create or replace function public.checkout_shared_tool(
  p_tool_id bigint, p_site_id bigint,
  p_employee_id bigint default null, p_note text default null
)
returns public.tools
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.employees%rowtype;
  v_before public.tools%rowtype;
  v_saved public.tools%rowtype;
  v_employee_id bigint;
begin
  begin
    select * into strict v_actor from public.employees
    where auth_user_id = auth.uid() and active = true;
  exception when no_data_found or too_many_rows then
    raise exception 'ログイン中の有効な社員情報を確認できません';
  end;

  -- Ordinary employees always check out as themselves. Never trust a client actor ID.
  v_employee_id := v_actor.id;
  if v_actor.admin_scope in ('all', 'tool_admin') then
    v_employee_id := coalesce(p_employee_id, v_actor.id);
  end if;
  perform 1 from public.employees where id = v_employee_id and active = true;
  if not found then raise exception '有効な持出者を選択してください'; end if;
  perform 1 from public.sites where id = p_site_id and visible = true;
  if not found then raise exception '表示中の現場を選択してください'; end if;

  select * into v_before from public.tools where id = p_tool_id for update;
  if not found then raise exception '工具情報が見つかりません'; end if;
  if v_before.ownership_type is distinct from 'shared'
     or v_before.active is distinct from true
     or v_before.checkout_managed is distinct from true then
    raise exception '持出対象の共有工具ではありません';
  end if;
  -- Same eligibility as SharedToolState.canCheckout; recheck under the row lock.
  if v_before.current_site_id is not null
     or v_before.status in ('repair', 'stopped', 'disposed') then
    raise exception 'この工具は現在持出できません';
  end if;

  update public.tools set current_site_id = p_site_id,
    assigned_employee_id = v_employee_id, status = 'in_use', updated_at = now()
  where id = v_before.id returning * into v_saved;
  if not found then raise exception '工具の持出登録に失敗しました'; end if;
  if v_saved.current_site_id is distinct from p_site_id
     or v_saved.assigned_employee_id is distinct from v_employee_id
     or v_saved.status is distinct from 'in_use'
     or v_saved.updated_at is null then
    raise exception '工具の持出更新結果が一致しません';
  end if;

  insert into public.tool_history (
    tool_id, action_type, from_site_id, to_site_id,
    from_employee_id, to_employee_id, operated_by_employee_id, note
  ) values (
    v_before.id, 'checkout', v_before.current_site_id, p_site_id,
    v_before.assigned_employee_id, v_employee_id, v_actor.id, nullif(btrim(p_note), '')
  );
  if not found then raise exception '持出履歴の保存に失敗しました'; end if;
  -- No mutation exception handler: either failure rolls back both writes.
  return v_saved;
end;
$$;

revoke all on function public.checkout_shared_tool(bigint,bigint,bigint,text) from public, anon;
grant execute on function public.checkout_shared_tool(bigint,bigint,bigint,text) to authenticated;
notify pgrst, 'reload schema';
commit;
