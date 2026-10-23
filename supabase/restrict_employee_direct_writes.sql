-- PREPARATION ONLY: apply AFTER bright-service and RPC client rollout/verification.
-- Does not change SELECT, RLS, service_role grants, owners or business RPCs.
begin;
do $$
declare col record; r text; before_service jsonb; after_service jsonb;
begin
  select jsonb_build_object('table',(select jsonb_object_agg(p,has_table_privilege('service_role','public.employees',p))
    from unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] ||
      case when current_setting('server_version_num')::integer>=170000 then array['MAINTAIN'] else array[]::text[] end) p),
    'columns',(select jsonb_agg(jsonb_build_array(a.attnum,p,has_column_privilege('service_role',a.attrelid,a.attnum,p)) order by a.attnum,p)
    from pg_catalog.pg_attribute a cross join unnest(array['SELECT','INSERT','UPDATE','REFERENCES']) p
    where a.attrelid='public.employees'::regclass and a.attnum>0 and not a.attisdropped)) into before_service;
  revoke insert,update,delete,truncate,references,trigger on public.employees from public,anon,authenticated;
  if current_setting('server_version_num')::integer>=170000 then
    execute 'revoke maintain on public.employees from public,anon,authenticated';
  end if;
  for col in select attname from pg_catalog.pg_attribute
    where attrelid='public.employees'::regclass and attnum>0 and not attisdropped loop
    execute format('revoke insert (%I), update (%I), references (%I) on public.employees from public,anon,authenticated',col.attname,col.attname,col.attname);
  end loop;
  -- Unknown inherited grants are NOT silently revoked from shared roles.
  -- Roll back the entire transaction until those sources have been reviewed.
  foreach r in array array['anon','authenticated'] loop
    if has_table_privilege(r,'public.employees','INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
      or has_any_column_privilege(r,'public.employees','INSERT,UPDATE,REFERENCES') then
      raise exception 'employees_inherited_write_requires_review: %',r;
    end if;
    if current_setting('server_version_num')::integer>=170000 and has_table_privilege(r,'public.employees','MAINTAIN') then
      raise exception 'employees_inherited_maintenance_requires_review: %',r;
    end if;
  end loop;
  select jsonb_build_object('table',(select jsonb_object_agg(p,has_table_privilege('service_role','public.employees',p))
    from unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] ||
      case when current_setting('server_version_num')::integer>=170000 then array['MAINTAIN'] else array[]::text[] end) p),
    'columns',(select jsonb_agg(jsonb_build_array(a.attnum,p,has_column_privilege('service_role',a.attrelid,a.attnum,p)) order by a.attnum,p)
    from pg_catalog.pg_attribute a cross join unnest(array['SELECT','INSERT','UPDATE','REFERENCES']) p
    where a.attrelid='public.employees'::regclass and a.attnum>0 and not a.attisdropped)) into after_service;
  if before_service is distinct from after_service then
    raise exception 'employees_service_role_privileges_would_change';
  end if;
end;
$$;
commit;
