-- Only for functions/policy newly created by personal_tool_registration.sql.
-- If pre-existing objects were replaced, restore their original definitions instead.
-- No data deletion. Preserve existing RLS state and tools_management_code_key.
begin;

drop policy if exists tools_registration_admin_insert_guard
  on public.tools;

drop function if exists public.register_personal_tool(text,text,text,text,text,text,text,text,text,text);
drop function if exists public.register_admin_tool(jsonb,text);
drop function if exists public.personal_tool_catalog();
drop function if exists public.allocate_tool_management_code(text,text);
drop function if exists public.tool_battery_prefix(text);
drop function if exists public.is_tool_registration_admin();

notify pgrst, 'reload schema';
commit;
