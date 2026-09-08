-- Incremental update for the already-installed personal tool registration feature.
-- Preserve catalog, administrator RPC, numbering, RLS and existing UNIQUE constraint.
begin;

drop function if exists public.register_personal_tool(text,text,text,text,text);
drop function if exists public.register_personal_tool(text,text,text,text,text,text);

create or replace function public.register_personal_tool(
  p_group text, p_name text, p_specification text default null,
  p_note text default null, p_lathe_size text default null,
  p_inspection_category text default null,
  p_manufacturer text default null, p_model_number text default null,
  p_serial_number text default null, p_performance text default null)
returns public.tools language plpgsql security definer set search_path = '' as $$
declare v_employee public.employees%rowtype; v_catalog record; v_tool public.tools%rowtype;
begin
  select * into strict v_employee from public.employees
    where auth_user_id = auth.uid() and active = true;
  select * into v_catalog from public.personal_tool_catalog()
    where tool_group = p_group and tool_name = p_name;
  if not found then raise exception '工具マスタから工具を選択してください'; end if;
  if p_group <> '充電工具' and (
    p_inspection_category is null or p_inspection_category not in (
      '3p', 'double_insulated', 'cord_reel', 'ac_welder', 'dc_welder'
    )
  ) then
    raise exception '点検区分は3P工具・二重絶縁工具・コードリール・交流式溶接機・直流式溶接機から選択してください';
  end if;
  insert into public.tools (tool_group, tool_name, management_code, specification, note,
    manufacturer, model_number, serial_number, performance,
    ownership_type, assigned_employee_id, owner_company_name, checkout_managed,
    inspection_required, inspection_category, status, active, current_site_id, updated_at)
  values (p_group, p_name, public.allocate_tool_management_code(p_name, p_lathe_size),
    nullif(trim(p_specification), ''), nullif(trim(p_note), ''),
    nullif(trim(p_manufacturer), ''), nullif(trim(p_model_number), ''),
    nullif(trim(p_serial_number), ''), nullif(trim(p_performance), ''),
    'personal', v_employee.id, null, true,
    p_group <> '充電工具',
    case when p_group = '充電工具' then null else p_inspection_category end,
    'available', true, null, now())
  returning * into v_tool;
  return v_tool;
exception when no_data_found then raise exception 'ログイン中の有効な社員情報を確認できません';
end;
$$;

revoke all on function public.register_personal_tool(text,text,text,text,text,text,text,text,text,text) from public, anon;
grant execute on function public.register_personal_tool(text,text,text,text,text,text,text,text,text,text) to authenticated;

notify pgrst, 'reload schema';
commit;
