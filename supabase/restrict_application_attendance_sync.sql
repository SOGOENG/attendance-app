-- PREPARATION ONLY. Independent security migration; no production execution.
-- Apply as existing function owner, after application attendance sync.
-- Internal callers are SECURITY DEFINER functions owned by the same DB owner.
-- No browser or Edge endpoint calls these internal helpers directly.
begin;
do $$
declare helper oid; caller oid;
begin
 foreach helper in array array[
  'public.sync_application_attendance_date(bigint,bigint,date,text)'::regprocedure::oid,
  'public.sync_approved_application_attendance(bigint)'::regprocedure::oid] loop
  foreach caller in array array[
   'public.sync_approved_application_attendance(bigint)'::regprocedure::oid,
   'public.handle_application_attendance_status()'::regprocedure::oid] loop
   if not exists(select 1 from pg_catalog.pg_proc h join pg_catalog.pg_proc c on c.oid=caller
    where h.oid=helper and c.prosecdef and h.proowner=c.proowner) then
    raise exception 'attendance_sync_owner_chain_review_required';
   end if;
  end loop;
 end loop;
end $$;
revoke all on function public.sync_application_attendance_date(bigint,bigint,date,text),
 public.sync_approved_application_attendance(bigint) from public,anon,authenticated,service_role;
-- Owners retain EXECUTE; approval/status triggers continue through that owner.
-- Server-side jobs needing this feature must use a separately authorized entry
-- point, not restore unauthenticated access to these unrestricted helpers.
notify pgrst,'reload schema';
commit;
