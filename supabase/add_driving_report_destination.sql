-- 本番未適用。既存driving_reportsの作成後に全体を実行。
-- Existing report values are not backfilled or updated. Sites are never inserted.
begin;
alter table public.driving_reports add column destination_text text;
comment on column public.driving_reports.destination_text is
  'その他（自由入力）の行先。現場マスタには登録せず日報内に保存する。';
alter table public.driving_reports
  add constraint driving_reports_destination_text_valid
    check (destination_text is null or (nullif(btrim(destination_text),'') is not null and length(destination_text)<=500)),
  add constraint driving_reports_destination_exclusive
    check (site_id is null or destination_text is null),
  add constraint driving_reports_no_driving_destination
    check (status<>'submitted' or driving_status<>'no_driving' or destination_text is null);
-- Existing prepare trigger retains site_name_snapshot ownership. destination_text
-- is ordinary report input, protected by the same owner RLS / submitted-edit guard.
-- The CHECK also runs for submit_driving_report(), atomically rejecting no_driving
-- submission with driving destination data. No route, audit, RPC or grant changes.
notify pgrst,'reload schema';
commit;
