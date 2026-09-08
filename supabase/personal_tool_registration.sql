-- Apply before deploying the UI. Existing tools rows are the tool master.
-- Management-code uniqueness uses the existing tools_management_code_key.
begin;

create or replace function public.is_tool_registration_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.employees
    where auth_user_id = auth.uid() and active = true
      and admin_scope in ('all', 'tool_admin'));
$$;

-- Fixed battery prefixes from the existing administrator registration screen.
create or replace function public.tool_battery_prefix(p_name text)
returns text language sql immutable set search_path = '' as $$
  select case p_name
    when '充電インパクト' then 'BI' when '充電ドライバー' then 'BD'
    when '充電ハンマードリル' then 'BHD' when '充電全ねじカッター' then 'BRC'
    when '充電パンチャー' then 'BP' when '充電セーパーソー' then 'BRS' end;
$$;

create or replace function public.allocate_tool_management_code(p_name text, p_lathe_size text default null)
returns text language plpgsql security definer set search_path = '' as $$
declare v_prefix text; v_number numeric; v_suffix text;
begin
  -- Shared by both registration RPCs; held until INSERT commits.
  perform pg_catalog.pg_advisory_xact_lock(712034, 1);
  if p_name = '旋盤' then
    if p_lathe_size is null or p_lathe_size not in ('1IN','2IN','3IN','4IN') then
      raise exception '旋盤サイズを選択してください';
    end if;
    v_prefix := 'SB-' || p_lathe_size;
  else
    select regexp_replace(management_code, '-[0-9]+$', '') into v_prefix
    from public.tools where tool_name = p_name and management_code ~ '^.+-[0-9]+$'
    group by 1 order by count(*) desc, min(id) asc limit 1;
    v_prefix := coalesce(v_prefix, public.tool_battery_prefix(p_name));
  end if;
  if v_prefix is null then
    raise exception '管理番号の採番設定がありません。管理者に工具マスタの登録を依頼してください';
  end if;
  select coalesce(max(substring(management_code from '([0-9]+)$')::numeric), 0) + 1
    into v_number from public.tools
    where management_code ~ '^.+-[0-9]+$'
      and regexp_replace(management_code, '-[0-9]+$', '') = v_prefix;
  v_suffix := v_number::text;
  return v_prefix || '-' || lpad(v_suffix, greatest(3, length(v_suffix)), '0');
end;
$$;

-- Remove the old signature before changing the catalog return type.
-- No CASCADE: unexpected dependencies must stop this migration.
drop function if exists public.register_personal_tool(text,text,text,text,text);
drop function if exists public.register_personal_tool(text,text,text,text,text,text);
drop function if exists public.personal_tool_catalog();

create function public.personal_tool_catalog()
returns table(tool_group text, tool_name text)
language sql stable security definer set search_path = '' as $$
  select names.tool_group, names.tool_name
  from (
    select t.tool_group, t.tool_name from public.tools t
    where t.tool_group is not null and t.tool_name is not null
    union
    select '充電工具', n from unnest(array['充電インパクト','充電ドライバー',
      '充電ハンマードリル','充電全ねじカッター','充電パンチャー','充電セーパーソー']) n
  ) names
  where exists (select 1 from public.employees where auth_user_id = auth.uid() and active = true)
  order by names.tool_group, names.tool_name;
$$;

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

-- Administrator automatic registration uses the very same allocator.
-- Manual codes and edits continue through the existing REST endpoint.
create or replace function public.register_admin_tool(p_record jsonb, p_lathe_size text default null)
returns public.tools language plpgsql security definer set search_path = '' as $$
declare v_input public.tools%rowtype; v_tool public.tools%rowtype;
begin
  if not public.is_tool_registration_admin() then raise exception '管理者権限が必要です'; end if;
  v_input := jsonb_populate_record(null::public.tools, p_record);
  insert into public.tools (tool_group, management_code, tool_name, specification,
    ownership_type, assigned_employee_id, owner_company_name, checkout_managed,
    manufacturer, model_number, serial_number, performance, inspection_required,
    inspection_category, note, updated_at)
  values (v_input.tool_group, public.allocate_tool_management_code(v_input.tool_name, p_lathe_size),
    v_input.tool_name, v_input.specification, v_input.ownership_type, v_input.assigned_employee_id,
    v_input.owner_company_name, v_input.checkout_managed, v_input.manufacturer,
    v_input.model_number, v_input.serial_number, v_input.performance,
    case when v_input.tool_group = '充電工具' then false else v_input.inspection_required end,
    case when v_input.tool_group = '充電工具' then null else v_input.inspection_category end,
    v_input.note, now()) returning * into v_tool;
  return v_tool;
end;
$$;

alter table public.tools enable row level security;
-- Restrictive guard also applies when an existing permissive INSERT policy exists.
-- Ordinary users can insert only via register_personal_tool (no employee ID argument).
drop policy if exists tools_registration_admin_insert_guard on public.tools;
create policy tools_registration_admin_insert_guard on public.tools
  as restrictive for insert to public with check (public.is_tool_registration_admin());

revoke all on function public.allocate_tool_management_code(text,text) from public, anon, authenticated;
revoke all on function public.tool_battery_prefix(text) from public, anon, authenticated;
revoke all on function public.is_tool_registration_admin() from public, anon;
revoke all on function public.personal_tool_catalog() from public, anon;
revoke all on function public.register_personal_tool(text,text,text,text,text,text,text,text,text,text) from public, anon;
revoke all on function public.register_admin_tool(jsonb,text) from public, anon;
grant execute on function public.is_tool_registration_admin() to authenticated;
grant execute on function public.personal_tool_catalog() to authenticated;
grant execute on function public.register_personal_tool(text,text,text,text,text,text,text,text,text,text) to authenticated;
grant execute on function public.register_admin_tool(jsonb,text) to authenticated;

notify pgrst, 'reload schema';
commit;
