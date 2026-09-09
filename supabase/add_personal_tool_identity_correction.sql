-- Apply after add_personal_tool_update.sql. Replaces the normal RPC too for installed databases.
begin;

-- History detection is conservative: any matching reference blocks correction.
-- Include known history tables, conventional reference columns and all direct FKs
-- to tools.id / tools.management_code, even when their column/schema names differ.
create or replace function public.personal_tool_identity_has_history(p_tool_id bigint, p_code text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare r record; v_found boolean; v_any boolean := false;
begin
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception '工具名の訂正はREAD COMMITTEDトランザクションで実行してください';
  end if;
  if to_regclass('public.tool_inspections') is null
     or to_regclass('public.tool_history') is null
     or to_regclass('public.tool_battery_history') is null then
    raise exception '工具の運用記録を確認できません。管理者に連絡してください。';
  end if;
  if exists (
    select 1 from unnest(array['tool_inspections','tool_history','tool_battery_history']) as required(table_name)
    where not exists (select 1 from pg_catalog.pg_attribute a
      where a.attrelid = to_regclass('public.' || required.table_name)
        and a.attname = 'tool_id' and a.attnum > 0 and not a.attisdropped)
  ) then raise exception '工具の運用記録を確認できません。管理者に連絡してください。'; end if;
  if exists (
    select 1 from pg_catalog.pg_constraint fk
    join pg_catalog.pg_attribute target on target.attrelid = fk.confrelid and target.attnum = any(fk.confkey)
    where fk.contype = 'f' and fk.confrelid = 'public.tools'::regclass
      and target.attname not in ('id', 'management_code')
  ) then raise exception '未対応の工具参照があります。管理者に連絡してください。'; end if;
  for r in
    select distinct n.nspname, c.relname, a.attname,
      case when a.attname ~ '(^|_)management_code$' or exists (
        select 1 from pg_catalog.pg_constraint fk
        join pg_catalog.pg_attribute target on target.attrelid = fk.confrelid
          and target.attnum = fk.confkey[array_position(fk.conkey, a.attnum)]
        where fk.contype = 'f' and fk.conrelid = c.oid and a.attnum = any(fk.conkey)
          and fk.confrelid = 'public.tools'::regclass and target.attname = 'management_code'
      ) then 'code' else 'id' end as reference_kind
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    join pg_catalog.pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
    where c.relkind in ('r','p') and c.oid <> 'public.tools'::regclass and (
      (n.nspname = 'public' and (a.attname ~ '(^|_)tool_id$' or a.attname ~ '(^|_)management_code$'))
      or exists (select 1 from pg_catalog.pg_constraint fk
        where fk.contype = 'f' and fk.conrelid = c.oid and a.attnum = any(fk.conkey)
          and fk.confrelid = 'public.tools'::regclass))
    order by n.nspname, c.relname, a.attname
  loop
    -- SHARE blocks INSERT/UPDATE/DELETE until correction commits, including
    -- history tables lacking FKs. Queries after a wait see the committed rows.
    execute format('lock table %I.%I in share mode', r.nspname, r.relname);
    execute format('select exists(select 1 from %I.%I where %I::text = $1)',
      r.nspname, r.relname, r.attname)
      into v_found using case when r.reference_kind = 'code' then p_code else p_tool_id::text end;
    v_any := v_any or v_found;
  end loop;
  return v_any;
end;
$$;
revoke all on function public.personal_tool_identity_has_history(bigint,text) from public, anon, authenticated;

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

create or replace function public.correct_personal_tool_identity(
  p_tool_id bigint, p_group text, p_name text,
  p_specification text default null, p_note text default null,
  p_inspection_category text default null,
  p_manufacturer text default null, p_model_number text default null,
  p_serial_number text default null, p_performance text default null,
  p_lathe_size text default null)
returns public.tools language plpgsql security definer set search_path = '' as $$
declare v_employee public.employees%rowtype; v_tool public.tools%rowtype; v_code text;
begin
  select * into strict v_employee from public.employees
    where auth_user_id = auth.uid() and active = true;
  perform 1 from public.tools where id = p_tool_id and ownership_type = 'personal'
    and assigned_employee_id = v_employee.id;
  if not found then raise exception '本人所有の個人工具だけ修正できます'; end if;
  -- Same lock as the allocator, before history/table and tool-row locks.
  perform pg_catalog.pg_advisory_xact_lock(712034, 1);
  -- Lock referenced tables before taking the tool row lock (FK writers may hold it).
  perform public.personal_tool_identity_has_history(p_tool_id, null);
  select * into v_tool from public.tools
    where id = p_tool_id and ownership_type = 'personal'
      and assigned_employee_id = v_employee.id for update;
  if not found then raise exception '本人所有の個人工具だけ修正できます'; end if;
  if v_tool.tool_group is not distinct from p_group and v_tool.tool_name is not distinct from p_name then
    raise exception '工具名に変更がありません。通常の修正を使用してください';
  end if;
  if public.personal_tool_identity_has_history(p_tool_id, v_tool.management_code)
     or v_tool.current_site_id is not null or v_tool.status is distinct from 'available'
     or v_tool.active is distinct from true then
    raise exception 'この工具はすでに点検や使用の記録があるため、工具名を訂正できません。管理者に連絡してください。';
  end if;
  perform 1 from public.personal_tool_catalog()
    where tool_group = p_group and tool_name = p_name;
  if not found then raise exception '工具マスタから工具を選択してください'; end if;
  if p_group <> '充電工具' and (
    p_inspection_category is null or p_inspection_category not in (
      '3p', 'double_insulated', 'cord_reel', 'ac_welder', 'dc_welder'
    )
  ) then raise exception '点検区分を選択してください'; end if;

  v_code := public.allocate_tool_management_code(p_name, p_lathe_size);
  -- Same row and owner; only this RPC can renumber, without a code input.
  update public.tools set
    tool_group = p_group, tool_name = p_name, management_code = v_code,
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

revoke all on function public.correct_personal_tool_identity(bigint,text,text,text,text,text,text,text,text,text,text) from public, anon;
grant execute on function public.correct_personal_tool_identity(bigint,text,text,text,text,text,text,text,text,text,text) to authenticated;
notify pgrst, 'reload schema';
commit;
