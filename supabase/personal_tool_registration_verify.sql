-- Run AFTER personal_tool_registration.sql, as postgres in a test database.
-- Requires an active ordinary employee and an active tool administrator linked to Auth.
-- Every inserted tool is rolled back (sequence values may still advance).
begin;
do $$
declare v_user uuid; v_admin uuid; v_employee bigint; v_tool public.tools%rowtype;
  v_second public.tools%rowtype; v_catalog record; v_category text;
begin
  -- Same group/name, different categories: neither catalog nor registration may reject it.
  insert into public.tools(tool_group, tool_name, management_code, ownership_type,
    inspection_required, inspection_category)
  values
    ('その他','本人登録カテゴリ検証','SELF-CATEGORY-TEST-001','shared',true,'3p'),
    ('その他','本人登録カテゴリ検証','SELF-CATEGORY-TEST-002','shared',true,'double_insulated');
  select auth_user_id, id into strict v_user, v_employee from public.employees
    where active and auth_user_id is not null
      and coalesce(admin_scope, '') not in ('all','tool_admin') order by id limit 1;
  select auth_user_id into strict v_admin from public.employees
    where active and auth_user_id is not null and admin_scope in ('all','tool_admin')
    order by id limit 1;
  perform set_config('request.jwt.claim.sub', v_user::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub',v_user,'role','authenticated')::text, true);
  set local role authenticated;
  select * into strict v_catalog from public.personal_tool_catalog()
    where tool_group = '充電工具' and tool_name = '充電インパクト';
  v_tool := public.register_personal_tool('充電工具','充電インパクト','テスト規格','テスト',null,'invalid-ignored');
  if v_tool.ownership_type <> 'personal' or v_tool.assigned_employee_id <> v_employee
    or v_tool.status <> 'available' or v_tool.inspection_required is distinct from false
    or v_tool.inspection_category is not null or v_tool.checkout_managed is distinct from true
    or v_tool.active is distinct from true or v_tool.current_site_id is not null
    or v_tool.management_code !~ '^.+-[0-9]{3,}$' then
    raise exception 'FAIL: personal defaults';
  end if;
  v_second := public.register_personal_tool('充電工具','充電インパクト');
  if v_tool.management_code = v_second.management_code then raise exception 'FAIL: duplicate code'; end if;
  if v_second.manufacturer is not null or v_second.model_number is not null
    or v_second.serial_number is not null or v_second.performance is not null then
    raise exception 'FAIL: omitted details must be NULL';
  end if;
  v_second := public.register_personal_tool(
    p_group => '充電工具', p_name => '充電インパクト',
    p_manufacturer => ' メーカーA ', p_model_number => ' MODEL-01 ',
    p_serial_number => ' 000123 ', p_performance => ' 100V ');
  if v_second.manufacturer is distinct from 'メーカーA'
    or v_second.model_number is distinct from 'MODEL-01'
    or v_second.serial_number is distinct from '000123'
    or v_second.performance is distinct from '100V' then
    raise exception 'FAIL: details must be saved and trimmed';
  end if;
  v_second := public.register_personal_tool(
    p_group => '充電工具', p_name => '充電インパクト',
    p_manufacturer => '', p_model_number => ' ', p_serial_number => '', p_performance => ' ');
  if v_second.manufacturer is not null or v_second.model_number is not null
    or v_second.serial_number is not null or v_second.performance is not null then
    raise exception 'FAIL: empty details must be NULL';
  end if;
  select * into strict v_catalog from public.personal_tool_catalog()
    where tool_group = 'その他' and tool_name = '本人登録カテゴリ検証';
  foreach v_category in array array['3p','double_insulated','cord_reel','ac_welder','dc_welder'] loop
    v_second := public.register_personal_tool(
      p_group => 'その他', p_name => '本人登録カテゴリ検証', p_inspection_category => v_category);
    if v_second.inspection_required is distinct from true
      or v_second.inspection_category is distinct from v_category then
      raise exception 'FAIL: selected category %', v_category;
    end if;
  end loop;
  foreach v_category in array array[null::text,'','battery','invalid','3P',' 3p '] loop
    begin
      perform public.register_personal_tool(
        p_group => 'その他', p_name => '本人登録カテゴリ検証', p_inspection_category => v_category);
      raise exception 'FAIL: invalid category accepted';
    exception when raise_exception then
      if sqlerrm not like '点検区分は%' then raise; end if;
    end;
  end loop;
  begin
    perform public.register_personal_tool('その他','充電インパクト');
    raise exception 'FAIL: invalid group accepted';
  exception when raise_exception then
    if sqlerrm like 'FAIL:%' then raise; end if;
  end;
  begin
    insert into public.tools(tool_group, tool_name, management_code, ownership_type, assigned_employee_id)
    values ('充電工具','充電インパクト','TEST-IMPERSONATION','personal',v_employee);
    raise exception 'FAIL: direct insert accepted';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.register_admin_tool(jsonb_build_object('tool_name','充電インパクト'));
    raise exception 'FAIL: ordinary user called admin RPC';
  exception when raise_exception then
    if sqlerrm like 'FAIL:%' then raise; end if;
  end;
  reset role;
  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub',v_admin,'role','authenticated')::text, true);
  set local role authenticated;
  v_second := public.register_admin_tool(jsonb_build_object(
    'tool_group','充電工具','tool_name','充電インパクト','ownership_type','shared',
    'checkout_managed',true,'inspection_required',false));
  if v_second.ownership_type <> 'shared' or v_second.management_code = v_tool.management_code then
    raise exception 'FAIL: administrator registration';
  end if;
  reset role;
  raise notice 'PASS: personal defaults, five categories, invalid/null category rejection, mixed existing categories, numbering, group validation, direct insert guard, admin authorization';
end;
$$;
rollback;
