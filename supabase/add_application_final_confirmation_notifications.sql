-- Apply after notification_deliveries.sql, add_application_notifications.sql,
-- and add_application_final_approval.sql. No historical deliveries are created.
begin;
alter table public.notification_deliveries
 drop constraint if exists notification_deliveries_notification_type_check,
 drop constraint if exists notification_deliveries_application_event_check;
alter table public.notification_deliveries
 add constraint notification_deliveries_notification_type_check check (notification_type in (
  'overdue_submission','today_schedule','tomorrow_schedule',
  'application_submitted','application_approved','application_revision_required',
  'application_rejected','application_final_confirmation_pending'
 )),
 add constraint notification_deliveries_application_event_check check (
  application_id is null or event_type in (
   'submitted','approved','revision_required','rejected','final_confirmation_pending'
  )
 );
-- The existing UNIQUE(idempotency_key) reserves one delivery per
-- application + event + employee + subscription atomically before sending.
-- Keep RLS and all client grants unchanged; only the service-role Edge sends.
notify pgrst,'reload schema';
commit;
