-- Apply after add_tool_catalog.sql. Function definitions only: no existing tools are updated.
begin;

-- Preserve the RPC return signature for installed callers.
create or replace function public.personal_tool_catalog()
returns table(tool_group text, tool_name text)
language sql stable security definer set search_path = '' as $$
  select c.tool_group,c.tool_name from public.tool_catalog c where c.active
    and exists(select 1 from public.employees where auth_user_id = auth.uid() and active = true)
  order by c.sort_order,c.tool_name,c.id;
$$;

-- Group-aware allocator for new registration. The old signature remains for identity correction.
create or replace function public.allocate_catalog_tool_management_code(p_group text,p_name text,p_lathe_size text default null)
returns text language plpgsql security definer set search_path = '' as $$
declare v_prefix text; v_number numeric; v_suffix text;
begin
  perform pg_catalog.pg_advisory_xact_lock(712034,1);
  if p_name = '旋盤' then
    if p_lathe_size is null or p_lathe_size not in ('1IN','2IN','3IN','4IN') then
      raise exception '旋盤サイズを選択してください';
    end if;
    -- Existing explicit size rule; never renumber SB-size tools.
    v_prefix := 'SB-' || p_lathe_size;
  else
    select c.code_prefix into v_prefix from public.tool_catalog c
      where c.tool_group=p_group and c.tool_name=p_name and c.active for share;
    if not found then raise exception '有効な工具名マスタを選択してください'; end if;
  end if;
  select coalesce(max(substring(management_code from '([0-9]+)$')::numeric),0)+1
    into v_number from public.tools where management_code ~ '^.+-[0-9]+$'
      and regexp_replace(management_code,'-[0-9]+$','')=v_prefix;
  v_suffix := v_number::text;
  return v_prefix || '-' || lpad(v_suffix,greatest(3,length(v_suffix)),'0');
end;
$$;
revoke all on function public.allocate_catalog_tool_management_code(text,text,text) from public,anon,authenticated;

create or replace function public.allocate_tool_management_code(p_name text,p_lathe_size text default null)
returns text language plpgsql security definer set search_path = '' as $$
declare v_group text;
begin
  if p_name = '旋盤' then
    return public.allocate_catalog_tool_management_code(null,p_name,p_lathe_size);
  end if;
  select c.tool_group into strict v_group from public.tool_catalog c where c.tool_name=p_name and c.active;
  return public.allocate_catalog_tool_management_code(v_group,p_name,p_lathe_size);
exception
  when no_data_found then raise exception '有効な工具名マスタがありません';
  when too_many_rows then raise exception '同じ工具名が複数の大分類にあります。管理者に確認してください';
end;
$$;
revoke all on function public.allocate_tool_management_code(text,text) from public,anon,authenticated;

-- Applied to REST/manual registration too. Existing UPDATEs are unaffected.
create or replace function public.validate_new_tool_catalog() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform 1 from public.tool_catalog c
    where c.tool_group=new.tool_group and c.tool_name=new.tool_name and c.active for share;
  if not found then raise exception '新しい工具名は工具名マスタ管理から登録してください'; end if;
  return new;
end;
$$;
revoke all on function public.validate_new_tool_catalog() from public,anon,authenticated;
drop trigger if exists tools_catalog_insert on public.tools;
create trigger tools_catalog_insert before insert on public.tools
for each row execute function public.validate_new_tool_catalog();

-- RPC definitions appended below, in this same transaction.

drop function if exists public.register_personal_tool(text,text,text,text,text,text,text,text,text,text);
create or replace function public.register_personal_tool(
  p_group text, p_name text, p_specification text default null,
  p_note text default null, p_lathe_size text default null,
  p_inspection_category text default null,
  p_manufacturer text default null, p_model_number text default null,
  p_serial_number text default null, p_performance text default null,
  p_inspection_required boolean default null)
returns public.tools language plpgsql security definer set search_path = '' as $$
declare v_employee public.employees%rowtype; v_catalog record; v_tool public.tools%rowtype; v_required boolean;
begin
  select * into strict v_employee from public.employees
    where auth_user_id = auth.uid() and active = true;
  select * into v_catalog from public.tool_catalog
    where tool_group = p_group and tool_name = p_name and active for share;
  if not found then raise exception '工具マスタから工具を選択してください'; end if;
  v_required := coalesce(p_inspection_required, v_catalog.inspection_required);
  if p_inspection_required is null then
    p_inspection_category := coalesce(p_inspection_category, v_catalog.inspection_category);
  end if;
  if (v_required and p_inspection_category is null) or (
    p_inspection_category is not null and p_inspection_category not in (
      '3p', 'double_insulated', 'battery', 'cord_reel', 'ac_welder', 'dc_welder'
    )
  ) then
    raise exception '有効な点検区分を選択してください';
  end if;
  insert into public.tools (tool_group, tool_name, management_code, specification, note,
    manufacturer, model_number, serial_number, performance,
    ownership_type, assigned_employee_id, owner_company_name, checkout_managed,
    inspection_required, inspection_category, status, active, current_site_id, updated_at)
  values (p_group, p_name, public.allocate_catalog_tool_management_code(p_group, p_name, p_lathe_size),
    nullif(trim(p_specification), ''), nullif(trim(p_note), ''),
    nullif(trim(p_manufacturer), ''), nullif(trim(p_model_number), ''),
    nullif(trim(p_serial_number), ''), nullif(trim(p_performance), ''),
    'personal', v_employee.id, null, true,
    v_required,
    p_inspection_category,
    'available', true, null, now())
  returning * into v_tool;
  return v_tool;
exception when no_data_found then raise exception 'ログイン中の有効な社員情報を確認できません';
end;
$$;


revoke all on function public.register_personal_tool(text,text,text,text,text,text,text,text,text,text,boolean) from public, anon;
grant execute on function public.register_personal_tool(text,text,text,text,text,text,text,text,text,text,boolean) to authenticated;

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
  values (v_input.tool_group, public.allocate_catalog_tool_management_code(v_input.tool_group, v_input.tool_name, p_lathe_size),
    v_input.tool_name, v_input.specification, v_input.ownership_type, v_input.assigned_employee_id,
    v_input.owner_company_name, v_input.checkout_managed, v_input.manufacturer,
    v_input.model_number, v_input.serial_number, v_input.performance,
    v_input.inspection_required,
    v_input.inspection_category,
    v_input.note, now()) returning * into v_tool;
  return v_tool;
end;
$$;


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
  if p_inspection_category is distinct from v_tool.inspection_category and (
    (v_tool.inspection_required and p_inspection_category is null) or p_inspection_category not in (
      '3p', 'double_insulated', 'battery', 'cord_reel', 'ac_welder', 'dc_welder'
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
    inspection_required = v_tool.inspection_required,
    inspection_category = p_inspection_category,
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
