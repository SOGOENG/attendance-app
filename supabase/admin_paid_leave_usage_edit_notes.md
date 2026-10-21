# 管理者直接登録の有給使用 編集・削除

`add_admin_paid_leave_usage.sql` と `leave_manager_balance_permissions.sql` が適用済みの環境向け。
レビュー後に `add_admin_paid_leave_usage_edit.sql` を適用する。本番への自動実行は行わない。
UIは `applications-admin.html` のJS/CSSバージョンを更新するため、service workerの変更は不要。

- 公開RPC: `update_admin_paid_leave_usage(p_transaction_id, p_employee_id, p_usage_date, p_days, p_note)`、`delete_admin_paid_leave_usage(p_transaction_id, p_employee_id)`。
- 既存の `is_leave_manager()` と操作者IDを検証。氏名・全体管理者権限による特例なし。
- 有効な `application_usage`、`application_id IS NULL`、`admin_paid_usage:日付:UUID` の識別子、対象社員一致を必須とする。
- 編集は元トランザクションの使用日・負の日数・備考を更新。社員、登録者、初回登録日時は保持する。
- 年度変更時は対応する既存残数行へ移動。移動先の未登録・経理取込基準日以前は拒否する。
- 社員の残数行をID順、次に対象トランザクションをロック。既存の `recalculate_paid_leave_balance` で両年度を再計算し、残数不足は監査を含め全体ロールバックする。
- 削除は `active=false` にし、再計算で残数を復元。無効履歴の再編集・再削除は拒否する。
- 監査は既存 `paid_leave_balance_transactions` に `adjustment`、0日、`active=false` で記録する。`source_key` は `admin_paid_usage_audit:対象ID:UUID`、`reason` は操作・変更前後のJSON、登録者と登録日時は実行者と実行日時。残数と直接登録履歴には混入しない。
- 申請レコード・申請承認処理・出勤簿同期処理には変更を加えない。

隔離DBテスト: `PGLITE_MODULE` にPGliteの `dist/index.js` を指定して `node tests/admin-paid-usage-edit-db.test.mjs`。
UIテスト: `PLAYWRIGHT_MODULE` にPlaywrightの `index.mjs` を指定して `node tests/admin-paid-usage-edit-ui.test.mjs`。Edgeを利用する。
