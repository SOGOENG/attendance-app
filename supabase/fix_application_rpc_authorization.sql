-- Independent application authorization fix; no business-data/schema changes.
-- Apply only after SELECT preflight review. Exact production definitions/ACLs or exact rerun.
begin;
do $$
declare r record; p record; stage text; acl_roles text[];
begin
 if current_user <> 'postgres' then raise exception 'application_rpc_owner_requires_review'; end if;
 for r in select * from (values
 ('cancel_application(bigint,text)',array['16010d88f669b10f948e98e491619717','becb8c06eeb9f6af432e8ff7a78e22bb'],'d21f4855088047f53ce160825486515d',false),
 ('reopen_application_draft(bigint)',array['7952991b7fbf1aaa9186fef71d4d05f8','34bb1bbd712e471777214303122b3bf0'],'be0e38a0ed7ffd167101985af203fc01',false),
 ('recalculate_paid_leave_balance(bigint)',array['ac27fe0337578f0b49e39db2b14fa2d9','4ce39d72d347a1545dae49eab2551b8e'],'4ce39d72d347a1545dae49eab2551b8e',true)) v(signature,original_hashes,patched_hash,is_recalculation) order by signature loop
  select * into p from pg_catalog.pg_proc where oid=pg_catalog.to_regprocedure('public.'||r.signature);
  if not found or p.proowner<>(select oid from pg_catalog.pg_roles where rolname='postgres')
    or not p.prosecdef or p.prorettype<>'void'::regtype or p.provolatile<>'v'
    or p.proisstrict or p.proleakproof or p.proparallel<>'u'
    or p.pronargdefaults<>(case when r.signature='cancel_application(bigint,text)' then 1 else 0 end)
    or p.proargnames is distinct from (case when r.signature='cancel_application(bigint,text)' then array['p_application_id','p_comment']::text[] when r.is_recalculation then array['p_balance_id']::text[] else array['p_application_id']::text[] end)
    or pg_catalog.pg_get_expr(p.proargdefaults,0) is distinct from (case when r.signature='cancel_application(bigint,text)' then 'NULL::text'::text else null::text end)
    or p.prolang<>(select oid from pg_catalog.pg_language where lanname='plpgsql')
    or p.proconfig is distinct from array['search_path=public, pg_temp']::text[]
  then raise exception 'application_rpc_definition_requires_review: %',r.signature; end if;
  select array_agg(pg_catalog.pg_get_userbyid(a.grantee)::text order by pg_catalog.pg_get_userbyid(a.grantee)::text)
    into acl_roles from pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
    where a.privilege_type='EXECUTE' and not a.is_grantable and a.grantor=p.proowner;
  if exists(select 1 from pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
    where a.is_grantable or a.grantor<>p.proowner or a.grantee=0) then
    raise exception 'application_rpc_acl_requires_review: %',r.signature;
  end if;
  if stage is null then
   if md5(p.prosrc)=any(r.original_hashes) and acl_roles=array['anon','authenticated','postgres','service_role']::text[] then stage:='original';
   elsif md5(p.prosrc)=r.patched_hash and acl_roles=array['authenticated','postgres','service_role']::text[] then stage:='patched';
   else raise exception 'application_rpc_state_requires_review: %',r.signature; end if;
  end if;
  if stage='original' then
   if not(md5(p.prosrc)=any(r.original_hashes)) or acl_roles is distinct from array['anon','authenticated','postgres','service_role']::text[] then
    raise exception 'application_rpc_original_requires_review: %',r.signature; end if;
  elsif not (md5(p.prosrc)=r.patched_hash or (r.is_recalculation and md5(p.prosrc)=any(r.original_hashes))) or acl_roles is distinct from
    (case when r.is_recalculation then array['postgres','service_role']::text[] else array['authenticated','postgres','service_role']::text[] end) then
    raise exception 'application_rpc_patched_requires_review: %',r.signature;
  end if;
 end loop;
end;
$$;
CREATE OR REPLACE FUNCTION public.cancel_application(p_application_id bigint, p_comment text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_app public.applications%rowtype;
  v_actor bigint;
  v_balance_id bigint;
  v_record_id bigint;
begin
  v_actor := public.current_employee_id();
  if auth.uid() is null or v_actor is null then
    raise exception 'active_employee_required' using errcode='42501';
  end if;
  select * into v_app from public.applications
  where id = p_application_id for update;
  if not found then raise exception 'application_not_found'; end if;

  if v_app.status = 'cancelled' then return; end if;
  if not public.is_application_admin() then
    if v_app.employee_id is distinct from v_actor then raise exception 'forbidden'; end if;
    if v_app.status not in ('draft', 'submitted', 'revision_required') then
      raise exception 'admin_required_to_cancel_approved_application';
    end if;
  end if;

  if v_app.status = 'approved' and v_app.application_type = 'paid_leave' then
    select balance_id into v_balance_id
    from public.paid_leave_balance_transactions
    where application_id = v_app.id and transaction_type = 'application_usage'
    for update;
    update public.paid_leave_balance_transactions
      set active = false
      where application_id = v_app.id and transaction_type = 'application_usage';
  elsif v_app.status = 'approved' and v_app.application_type = 'comp_leave' then
    perform 1 from public.holiday_work_records h
    where h.id in (select holiday_work_record_id from public.comp_leave_allocations
      where application_id = v_app.id)
    order by h.id for update;
  end if;

  update public.applications
  set status = 'cancelled', reviewer_comment = coalesce(nullif(trim(p_comment), ''), reviewer_comment),
      approved_at = null, approved_by_employee_id = null,
      rejected_at = null, rejected_by_employee_id = null
  where id = v_app.id;

  if v_balance_id is not null then
    perform public.recalculate_paid_leave_balance(v_balance_id);
  end if;
  if v_app.status = 'approved' and v_app.application_type = 'comp_leave' then
    for v_record_id in select holiday_work_record_id from public.comp_leave_allocations
      where application_id = v_app.id order by holiday_work_record_id
    loop
      perform public.recalculate_holiday_work_record(v_record_id);
    end loop;
  end if;

  insert into public.application_status_history
    (application_id, from_status, to_status, comment, changed_by_employee_id)
  values (v_app.id, v_app.status, 'cancelled', nullif(trim(p_comment), ''), v_actor);
end;
$function$;

CREATE OR REPLACE FUNCTION public.reopen_application_draft(p_application_id bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_app public.applications%rowtype;
begin
  if auth.uid() is null or public.current_employee_id() is null then
    raise exception 'active_employee_required' using errcode='42501';
  end if;
  select * into v_app from public.applications
  where id = p_application_id for update;
  if not found then raise exception 'application_not_found'; end if;
  if v_app.employee_id is distinct from public.current_employee_id() then raise exception 'forbidden'; end if;
  if v_app.status <> 'revision_required' then raise exception 'application_not_revision_required'; end if;

  update public.applications set status = 'draft' where id = v_app.id;
  insert into public.application_status_history
    (application_id, from_status, to_status, changed_by_employee_id)
  values (v_app.id, v_app.status, 'draft', public.current_employee_id());
end;
$function$;

revoke execute on function public.cancel_application(bigint,text),public.reopen_application_draft(bigint) from public,anon;
revoke execute on function public.recalculate_paid_leave_balance(bigint) from public,anon,authenticated;
-- Existing authenticated entry and service_role grants are retained, not broadened.
do $$
begin
 if pg_catalog.has_function_privilege('anon','public.cancel_application(bigint,text)','EXECUTE')
 or pg_catalog.has_function_privilege('anon','public.reopen_application_draft(bigint)','EXECUTE')
 or pg_catalog.has_function_privilege('anon','public.recalculate_paid_leave_balance(bigint)','EXECUTE')
 or pg_catalog.has_function_privilege('authenticated','public.recalculate_paid_leave_balance(bigint)','EXECUTE') then
  raise exception 'application_rpc_inherited_execute_requires_review';
 end if;
 if not pg_catalog.has_function_privilege('service_role','public.recalculate_paid_leave_balance(bigint)','EXECUTE') then
  raise exception 'application_rpc_service_execute_missing';
 end if;
end;
$$;
notify pgrst,'reload schema';
commit;
