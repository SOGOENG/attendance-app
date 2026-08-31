-- Direct REST inserts must also be limited to active tool administrators.
-- This file is intentionally not executed automatically.

alter table public.tool_inspection_cycles enable row level security;

drop policy if exists tool_inspection_cycles_admin_insert_restriction
  on public.tool_inspection_cycles;

create policy tool_inspection_cycles_admin_insert_restriction
on public.tool_inspection_cycles
as restrictive
for insert
to public
with check (
  exists (
    select 1
    from public.employees
    where employees.auth_user_id = auth.uid()
      and employees.active = true
      and employees.admin_scope in ('all', 'tool_admin')
  )
);
