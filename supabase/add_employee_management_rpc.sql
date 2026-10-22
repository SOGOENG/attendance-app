-- LOCAL PREPARATION ONLY. Apply as reviewed owner before client migration.
-- Requires employees profile/leave-manager columns and fuel_receipt_roles.
begin;
create or replace function public.employee_edit_context()
returns jsonb language plpgsql stable security definer set search_path='' set row_security=off as $$
declare a public.employees; n integer;
begin
  select count(*) into n from public.employees where auth_user_id=auth.uid();
  if auth.uid() is null or n<>1 then raise exception 'employee_manager_required' using errcode='42501'; end if;
  select * into a from public.employees where auth_user_id=auth.uid() and active;
  if a.id is null or a.admin_scope not in ('all','工事部','技術部','営業部','総務部') or a.admin_scope is null then
    raise exception 'employee_manager_required' using errcode='42501'; end if;
  return jsonb_build_object('all',a.admin_scope='all','actor_id',a.id,'creation_enabled',false,
    'department',case when a.admin_scope<>'all' then a.admin_scope end,
    'editable_ids',(select coalesce(jsonb_agg(e.id order by e.id),'[]'::jsonb) from public.employees e
      where a.admin_scope='all' or (e.department=a.admin_scope and e.admin_scope='none'
        and e.is_leave_manager is false and not exists(select 1 from public.fuel_receipt_roles r where r.employee_id=e.id))));
end;
$$;

-- Private common implementation; two entry points prevent over-posting in dept mode.
create or replace function public.employee_edit_internal(p_id bigint,p_data jsonb,p_expected jsonb,p_all boolean)
returns jsonb language plpgsql security definer set search_path='' set row_security=off as $$
declare a public.employees; e public.employees; v_allowed text[]; k text; v_current jsonb; n integer;
begin
  -- Same lock as vehicle assignment; employee rows are locked in ID order.
  if not p_all then lock table public.fuel_receipt_roles in share mode; end if;
  perform pg_catalog.pg_advisory_xact_lock(726314923);
  select count(*) into n from public.employees where auth_user_id=auth.uid();
  if auth.uid() is null or n<>1 then raise exception 'employee_manager_required' using errcode='42501'; end if;
  perform 1 from public.employees where id=p_id or auth_user_id=auth.uid() order by id for update;
  select * into a from public.employees where auth_user_id=auth.uid() and active;
  select * into e from public.employees where id=p_id;
  if a.id is null or e.id is null then raise exception 'employee_manager_required' using errcode='42501'; end if;
  if p_all then
    if a.admin_scope is distinct from 'all' then raise exception 'employee_manager_required' using errcode='42501'; end if;
    v_allowed:=array['name','department','job_title','profile_email','phone_number','active','admin_scope',
      'attendance_required','improvement_required','near_miss_required'];
  else
    if a.admin_scope is null or a.admin_scope not in ('工事部','技術部','営業部','総務部')
      or e.department is distinct from a.admin_scope or e.admin_scope is distinct from 'none'
      or e.is_leave_manager is distinct from false
      or exists(select 1 from public.fuel_receipt_roles r where r.employee_id=e.id)
    then raise exception 'department_employee_required' using errcode='42501'; end if;
    v_allowed:=array['name','attendance_required','improvement_required','near_miss_required'];
  end if;
  if jsonb_typeof(p_data) is distinct from 'object' or jsonb_typeof(p_expected) is distinct from 'object'
    or (select count(*) from jsonb_object_keys(p_data))<>cardinality(v_allowed)
    or (select count(*) from jsonb_object_keys(p_expected))<>cardinality(v_allowed)
  then raise exception 'invalid_employee_values'; end if;
  v_current:=to_jsonb(e);
  foreach k in array v_allowed loop
    if not p_data ? k or not p_expected ? k then raise exception 'invalid_employee_values'; end if;
    if (v_current->k) is distinct from (p_expected->k) then raise exception 'employee_edit_conflict'; end if;
    if k in ('active','attendance_required','improvement_required','near_miss_required') then
      if jsonb_typeof(p_data->k) is distinct from 'boolean' then raise exception 'invalid_employee_values'; end if;
    elsif k in ('job_title','profile_email','phone_number') and p_data->k='null'::jsonb then
      null;
    elsif jsonb_typeof(p_data->k) is distinct from 'string' then raise exception 'invalid_employee_values'; end if;
  end loop;
  if length(trim(p_data->>'name')) not between 1 and 100
    or length(coalesce(p_data->>'job_title',''))>100 or length(coalesce(p_data->>'profile_email',''))>254
    or length(coalesce(p_data->>'phone_number',''))>100
    or (coalesce(p_data->>'profile_email','')<>'' and p_data->>'profile_email' !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$')
    or (p_all and (p_data->>'department' not in ('工事部','技術部','営業部','総務部')
      or p_data->>'admin_scope' not in ('none','all','tool_admin','工事部','技術部','営業部','総務部')))
  then raise exception 'invalid_employee_values'; end if;
  update public.employees set name=trim(p_data->>'name'),
    attendance_required=(p_data->>'attendance_required')::boolean,
    improvement_required=(p_data->>'improvement_required')::boolean,
    near_miss_required=(p_data->>'near_miss_required')::boolean,
    department=case when p_all then p_data->>'department' else department end,
    active=case when p_all then (p_data->>'active')::boolean else active end,
    admin_scope=case when p_all then p_data->>'admin_scope' else admin_scope end,
    job_title=case when p_all then nullif(trim(p_data->>'job_title'),'') else job_title end,
    profile_email=case when p_all then nullif(trim(p_data->>'profile_email'),'') else profile_email end,
    phone_number=case when p_all then coalesce(p_data->>'phone_number','') else phone_number end
  where id=p_id returning * into e;
  return to_jsonb(e);
end;
$$;
create or replace function public.admin_edit_employee(p_id bigint,p_data jsonb,p_expected jsonb)
returns jsonb language sql security definer set search_path='' set row_security=off as $$
  select public.employee_edit_internal(p_id,p_data,p_expected,true);
$$;
create or replace function public.department_edit_employee(p_id bigint,p_data jsonb,p_expected jsonb)
returns jsonb language sql security definer set search_path='' set row_security=off as $$
  select public.employee_edit_internal(p_id,p_data,p_expected,false);
$$;
revoke all on function public.employee_edit_internal(bigint,jsonb,jsonb,boolean),public.employee_edit_context(),
  public.admin_edit_employee(bigint,jsonb,jsonb),public.department_edit_employee(bigint,jsonb,jsonb)
  from public,anon,authenticated,service_role;
grant execute on function public.employee_edit_context(),public.admin_edit_employee(bigint,jsonb,jsonb),
  public.department_edit_employee(bigint,jsonb,jsonb) to authenticated;
notify pgrst,'reload schema';
commit;
