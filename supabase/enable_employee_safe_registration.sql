-- FINAL RELEASE GATE ONLY. NOT EXECUTED. See employee_safe_registration_rollout.md.
-- The reviewed main SHA is an operator attestation, not automatic verification
-- of the deployed website. Verify the actual served files/Edge/Auth separately.
begin;
do $$
declare revision text:=current_setting('portal.reviewed_main_revision',true);
begin
 if revision is null or revision !~ '^[0-9a-f]{40}$'
  or current_setting('portal.auth_isolation_verified',true) is distinct from 'yes'
  or current_setting('portal.legacy_auth_reconciled',true) is distinct from 'yes'
 then raise exception 'main_edge_auth_and_legacy_review_required'; end if;
 if not public.employee_registration_ready() then raise exception 'employee_direct_writes_still_enabled'; end if;
 update public.employee_registration_settings set enabled=true,reviewed_main_revision=revision,activated_at=clock_timestamp() where singleton;
end; $$;
commit;
