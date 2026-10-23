-- LOCAL PREPARATION ONLY. Deploy/verify ID login BEFORE applying to shared production.
-- Does not alter RLS, employee rows, authenticated/service_role effective SELECT or RPCs.
-- Operator attestations are not automatic proof of deployed files or real Auth tests.
begin;
do $$
declare col record; before_read jsonb; after_read jsonb;
begin
  if current_user <> 'postgres' or
    coalesce(current_setting('portal.reviewed_login_revision',true),'') !~ '^[0-9a-f]{40}$' or
    current_setting('portal.id_login_verified',true) is distinct from 'yes'
  then raise exception 'reviewed_id_login_rollout_required'; end if;
  select jsonb_agg(jsonb_build_array(r,
    has_table_privilege(r,'public.employees','SELECT'),
    (select jsonb_agg(jsonb_build_array(a.attnum,has_column_privilege(r,a.attrelid,a.attnum,'SELECT')) order by a.attnum)
      from pg_catalog.pg_attribute a where a.attrelid='public.employees'::regclass and a.attnum>0 and not a.attisdropped)) order by r)
    into before_read from unnest(array['authenticated','service_role']) r;
  revoke select on public.employees from public,anon;
  for col in select attname from pg_catalog.pg_attribute
    where attrelid='public.employees'::regclass and attnum>0 and not attisdropped loop
    execute format('revoke select (%I) on public.employees from public,anon',col.attname);
  end loop;
  if has_table_privilege('anon','public.employees','SELECT') or
    has_any_column_privilege('anon','public.employees','SELECT') then
    raise exception 'employees_inherited_anonymous_read_requires_review';
  end if;
  select jsonb_agg(jsonb_build_array(r,
    has_table_privilege(r,'public.employees','SELECT'),
    (select jsonb_agg(jsonb_build_array(a.attnum,has_column_privilege(r,a.attrelid,a.attnum,'SELECT')) order by a.attnum)
      from pg_catalog.pg_attribute a where a.attrelid='public.employees'::regclass and a.attnum>0 and not a.attisdropped)) order by r)
    into after_read from unnest(array['authenticated','service_role']) r;
  if before_read is distinct from after_read or
    not has_table_privilege('authenticated','public.employees','SELECT') then
    raise exception 'employee_authenticated_reads_require_explicit_reviewed_grants';
  end if;
end; $$;
commit;
