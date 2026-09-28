# 代休の期限表示・自動失効

有効期限は `(work_date + interval '1 year')::date`（同日まで）。翌日から失効。
公開用 `get_comp_leave_availability` はJST当日で候補を絞る。返却列は変更しない。
内部集計は変更せず、過去取得・予約保護・承認時の計算を維持する。

## 本番反映順序

1. 既存の `add_comp_leave_expiration.sql` が適用済みであることを確認する。
   未適用の場合のみ先に同ファイルを適用する。基本SQLは再実行しない。
2. SQL Editorで `fix_comp_leave_expiration_visibility_and_automation.sql` を実行する。
   繰り返し適用可能。適用時には残数変更・失効実行・cron登録を行わない。
3. Edge FunctionのSecretsに十分に長いランダムな専用値
   `COMP_LEAVE_EXPIRATION_CRON_SECRET` を登録する。Push用secretは変更しない。
4. `expire-comp-leave-records` をデプロイする。
   CLI例: `supabase functions deploy expire-comp-leave-records --no-verify-jwt`
   この関数だけJWT検証を無効にする。関数内の `x-cron-secret` 検証を必須とし、
   DB接続にはランタイムの `SUPABASE_SERVICE_ROLE_KEY` を使用する。
5. 下記の初回呼び出しを行い、成功応答と失効履歴・残数を確認する。
6. DashboardのCronで日次HTTP POSTを設定する。既存のコード管理方式がないため、
   この変更にcron作成SQLは含めない。

## 初回処理・日次処理

POST `https://<project-ref>.supabase.co/functions/v1/expire-comp-leave-records`

- ヘッダー: `x-cron-secret: <登録した専用secret>`
- 本文: `{}`（日付・社員IDの指定は受け付けない）
- 成功: HTTP 200、`success: true`、`processed_records`、`newly_expired_days`
- 失敗: HTTP 401（secret不一致）、503（secret未設定）、500（DB処理失敗）

Dashboardの初回テストと日次ジョブで同じ呼び出しを使用する。
日次時刻例は毎日00:10 JST。UTCのcron設定なら `10 15 * * *`。
Dashboardのタイムゾーン表示を確認する。secretはVault等のサーバー側秘密管理に置き、
ブラウザーの公開コード・リポジトリ・ジョブの共有資料へ記載しない。
service_roleキーを呼び出し元へ渡す必要はない。
失敗したジョブは確認・再実行する。再実行で同じ日数を二重失効しない。

## 権限と予約保護

- 手動 `expire_comp_leave_records()` は従来どおり残数管理者だけが実行可能。
- 自動 `expire_comp_leave_records_automated()` のEXECUTEはservice_roleだけに付与。
- 共通 `expire_comp_leave_records_internal()` はPUBLIC/anon/authenticated/service_role
  から直接実行不可。権限付きラッパーのみが呼び出す。
- 共通処理は既存の失効計算をそのまま使用する。
  `max(remaining_days - 期限内取得のsubmitted予約日数, 0)` だけを失効する。
- 予約解放後の残数は次の日次処理で失効する。期限超過分はその間も新規候補には出ない。
- 自動処理は社員を偽装しない。既存の再計算処理に従い、社員認証のない自動更新の
  `updated_by_employee_id` はNULLになる。失効時刻・日数は失効履歴に記録される。
- 既存の残数再計算、失効履歴、RLS、承認権限は変更しない。

`applications.js` とService Workerは変更不要（静的画面変更なし）。

公式手順:
- https://supabase.com/docs/guides/functions/function-configuration
- https://supabase.com/docs/guides/functions/schedule-functions
