-- READ ONLY. Run as reviewed owner with complete employees/operation/Auth read
-- access. Never copies passwords, JWTs, names, email values or Auth UUIDs.
-- Entire history: keep results private; filter by operation_id locally if needed.
-- Absence of an Auth match is NOT proof that an old worker cannot still create it.
select o.operation_id,o.employee_id,o.state,o.failure_code,o.created_at,o.updated_at,
  e.id is not null as employee_exists,e.active as employee_active,
  e.auth_user_id is not null as employee_auth_linked,
  (select count(*) from auth.users u
    where u.email='employee-'||o.employee_id::text||'@staff-portal.local') as internal_email_auth_count,
  exists(select 1 from auth.users u where u.id=e.auth_user_id
    and u.email='employee-'||o.employee_id::text||'@staff-portal.local') as expected_auth_link_matches
from public.employee_creation_operations o
left join public.employees e on e.id=o.employee_id
order by o.created_at desc,o.operation_id;
