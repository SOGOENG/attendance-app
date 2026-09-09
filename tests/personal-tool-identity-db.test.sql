-- Generated from the production correction migration; disposable EMPTY test DB only.
-- psql -X -v ON_ERROR_STOP=1 -f tests/personal-tool-identity-db.test.sql
\set ON_ERROR_STOP on
begin;
do $$ begin
  if to_regclass('public.tools') is not null or to_regclass('public.employees') is not null
    or to_regnamespace('auth') is not null then
    raise exception 'Use an empty disposable test database only';
  end if;
end $$;
create schema auth;
create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
do $$ begin
  if not exists(select 1 from pg_roles where rolname='anon') then create role anon; end if;
  if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
end $$;
create table public.employees(id bigint primary key,auth_user_id uuid,active boolean);
create table public.tools(id bigint primary key,tool_group text,tool_name text,management_code text unique,
 specification text,note text,manufacturer text,model_number text,serial_number text,performance text,
 inspection_required boolean,inspection_category text,status text,active boolean,current_site_id bigint,
 ownership_type text,assigned_employee_id bigint,checkout_managed boolean,updated_at timestamptz);
create table public.tool_inspections(tool_id bigint references public.tools(id));
create table public.tool_history(tool_id bigint references public.tools(id));
create table public.tool_battery_history(tool_id bigint references public.tools(id));
create table public.qr_operation_history(tool_management_code text);
create table public.other_history(asset bigint references public.tools(id));
create function public.personal_tool_catalog() returns table(tool_group text,tool_name text)
language sql as $$ values ('充電工具','充電インパクト'),('充電工具','充電ドライバー'),('配管加工機','旋盤'),('別分類','充電インパクト') $$;
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


-- Apply after add_personal_tool_update.sql. Replaces the normal RPC too for installed databases.


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


insert into public.employees values(7,'00000000-0000-0000-0000-000000000007',true),(8,'00000000-0000-0000-0000-000000000008',true);
insert into public.tools(id,tool_group,tool_name,management_code,status,active,ownership_type,assigned_employee_id,checkout_managed)
values(42,'充電工具','充電インパクト','BI-001','available',true,'personal',7),
(43,'充電工具','充電ドライバー','BD-001','available',true,'personal',8),
(44,'充電工具','充電インパクト','BI-002','available',true,'shared',7);
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000007',true);
create function pg_temp.must_reject(statement text, expected text) returns void language plpgsql as $$
begin
  begin execute statement;
  exception when others then
    if position(expected in sqlerrm)=0 then raise; end if;
    return;
  end;
  raise exception 'Expected rejection: %',statement;
end $$;
do $$ declare t public.tools; before_row jsonb; after_row jsonb; relation text;
begin
  select to_jsonb(tools) into before_row from public.tools where id=42;
  perform public.update_personal_tool(42,'充電工具','充電インパクト',p_note=>'通常修正');
  select to_jsonb(tools) into after_row from public.tools where id=42;
  assert (before_row - array['note','inspection_required','updated_at']) = (after_row - array['note','inspection_required','updated_at']);
  perform pg_temp.must_reject($q$select public.update_personal_tool(42,'充電工具','充電ドライバー')$q$,'工具名を訂正する');
  perform pg_temp.must_reject($q$select public.correct_personal_tool_identity(43,'充電工具','充電インパクト')$q$,'本人所有');
  perform pg_temp.must_reject($q$select public.correct_personal_tool_identity(44,'充電工具','充電ドライバー')$q$,'本人所有');
  foreach relation in array array['tool_inspections','tool_history','tool_battery_history'] loop
    execute format('insert into public.%I values(42)',relation);
    perform pg_temp.must_reject($q$select public.correct_personal_tool_identity(42,'充電工具','充電ドライバー')$q$,'点検や使用の記録');
    perform public.update_personal_tool(42,'充電工具','充電インパクト',p_note=>'履歴があっても通常修正可');
    execute format('delete from public.%I',relation);
  end loop;
  insert into public.qr_operation_history values('BI-001');
  perform pg_temp.must_reject($q$select public.correct_personal_tool_identity(42,'充電工具','充電ドライバー')$q$,'点検や使用の記録');
  delete from public.qr_operation_history;
  insert into public.other_history values(42);
  perform pg_temp.must_reject($q$select public.correct_personal_tool_identity(42,'充電工具','充電ドライバー')$q$,'点検や使用の記録');
  delete from public.other_history;
  update public.tools set current_site_id=1 where id=42;
  perform pg_temp.must_reject($q$select public.correct_personal_tool_identity(42,'充電工具','充電ドライバー')$q$,'点検や使用の記録');
  update public.tools set current_site_id=null where id=42;
  perform pg_temp.must_reject($q$select public.correct_personal_tool_identity(42,'充電工具','自由入力')$q$,'マスタ');
  perform pg_temp.must_reject($q$select public.correct_personal_tool_identity(42,'配管加工機','旋盤',p_inspection_category=>'3p')$q$,'旋盤サイズ');
  t := public.correct_personal_tool_identity(42,'配管加工機','旋盤',p_inspection_category=>'3p',p_lathe_size=>'2IN');
  assert t.management_code='SB-2IN-001' and t.id=42 and t.assigned_employee_id=7 and t.ownership_type='personal';
  assert t.inspection_required and t.inspection_category='3p';
  t := public.correct_personal_tool_identity(42,'充電工具','充電ドライバー');
  assert t.management_code='BD-002' and not t.inspection_required and t.inspection_category is null;
  t := public.correct_personal_tool_identity(42,'充電工具','充電インパクト');
  t := public.correct_personal_tool_identity(42,'別分類','充電インパクト',p_inspection_category=>'3p');
  assert t.management_code like 'BI-%' and t.tool_group='別分類';
  assert not has_function_privilege('anon','public.correct_personal_tool_identity(bigint,text,text,text,text,text,text,text,text,text,text)','execute');
  assert not has_function_privilege('authenticated','public.personal_tool_identity_has_history(bigint,text)','execute');
  perform set_config('request.jwt.claim.sub','',true);
  perform pg_temp.must_reject($q$select public.correct_personal_tool_identity(42,'充電工具','充電ドライバー')$q$,'有効な社員');
  raise notice 'PASS: normal code preservation, history/owner/shared/master guards, QR code references, arbitrary FKs, allocator, lathe, battery, group-only correction, privileges';
end $$;
rollback;
