-- Apply after personal_tool_registration.sql (including registration details).
-- No existing policy, administrator RPC, allocator or table privilege is changed.
begin;

create or replace function public.update_personal_tool(
  p_tool_id bigint, p_group text, p_name text,
  p_specification text default null, p_note text default null,
  p_inspection_category text default null,
  p_manufacturer text default null, p_model_number text default null,
  p_serial_number text default null, p_performance text default null)
returns public.tools language plpgsql security definer set search_path = '' as $$
declare v_employee public.employees%rowtype; v_tool public.tools%rowtype;
begin
  select * into strict v_employee from public.employees
    where auth_user_id = auth.uid() and active = true;
  select * into v_tool from public.tools
    where id = p_tool_id and ownership_type = 'personal'
      and assigned_employee_id = v_employee.id for update;
  if not found then raise exception '本人所有の個人工具だけ修正できます'; end if;
  if v_tool.tool_group is distinct from p_group or v_tool.tool_name is distinct from p_name then
    raise exception '工具名は「工具名を訂正する」から変更してください';
  end if;
  perform 1 from public.personal_tool_catalog()
    where tool_group = p_group and tool_name = p_name;
  if not found then raise exception '工具マスタから工具を選択してください'; end if;
  if p_group <> '充電工具' and (
    p_inspection_category is null or p_inspection_category not in (
      '3p', 'double_insulated', 'cord_reel', 'ac_welder', 'dc_welder'
    )
  ) then raise exception '点検区分を選択してください'; end if;

  -- Explicit column allowlist. Ownership is checked in the UPDATE itself,
  -- including after a concurrent ownership change. Management code is never set.
  update public.tools set
    tool_group = p_group, tool_name = p_name,
    specification = nullif(trim(p_specification), ''),
    note = nullif(trim(p_note), ''),
    manufacturer = nullif(trim(p_manufacturer), ''),
    model_number = nullif(trim(p_model_number), ''),
    serial_number = nullif(trim(p_serial_number), ''),
    performance = nullif(trim(p_performance), ''),
    inspection_required = p_group <> '充電工具',
    inspection_category = case when p_group = '充電工具' then null else p_inspection_category end,
    updated_at = now()
  where id = p_tool_id and ownership_type = 'personal'
    and assigned_employee_id = v_employee.id
  returning * into v_tool;
  if not found then raise exception '本人所有の個人工具だけ修正できます'; end if;
  return v_tool;
exception when no_data_found then raise exception 'ログイン中の有効な社員情報を確認できません';
end;
$$;

revoke all on function public.update_personal_tool(bigint,text,text,text,text,text,text,text,text,text) from public, anon;
grant execute on function public.update_personal_tool(bigint,text,text,text,text,text,text,text,text,text) to authenticated;
notify pgrst, 'reload schema';
commit;
