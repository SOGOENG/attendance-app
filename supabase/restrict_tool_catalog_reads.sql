-- PREPARATION ONLY. Review tool_catalog_read_security_preflight.sql first.
-- Existing installation upgrade: do NOT rerun add_tool_catalog.sql's seed logic.
-- No table data, grants, INSERT/UPDATE policies, registration RPCs or tools change.
begin;
do $$
begin
  if not exists(select 1 from pg_catalog.pg_class
    where oid=pg_catalog.to_regclass('public.tool_catalog') and relrowsecurity)
    or not exists(select 1 from pg_catalog.pg_policy
      where polrelid=pg_catalog.to_regclass('public.tool_catalog')
        and polname='tool_catalog_read' and polcmd='r' and polpermissive)
  then raise exception 'tool_catalog_read_policy_requires_review'; end if;
  if pg_catalog.has_any_column_privilege('anon','public.tool_catalog','SELECT') then
    raise exception 'tool_catalog_anon_read_requires_review';
  end if;
  -- Never overwrite a same-name guard with an unexpected kind or role scope.
  if exists(select 1 from pg_catalog.pg_policy
    where polrelid='public.tool_catalog'::regclass and polname='tool_catalog_active_employee_read_guard'
      and (polcmd<>'r' or polpermissive or polroles<>array[(select oid from pg_catalog.pg_roles where rolname='authenticated')]))
  then raise exception 'tool_catalog_read_guard_requires_review'; end if;
end;
$$;
alter policy tool_catalog_read on public.tool_catalog
using (exists(select 1 from public.employees e where e.auth_user_id=auth.uid() and e.active=true));
drop policy if exists tool_catalog_active_employee_read_guard on public.tool_catalog;
create policy tool_catalog_active_employee_read_guard on public.tool_catalog
as restrictive for select to authenticated
using (exists(select 1 from public.employees e where e.auth_user_id=auth.uid() and e.active=true));
commit;
