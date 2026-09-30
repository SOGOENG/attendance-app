# 管理者直接登録の代休使用履歴の修正・削除

## 適用

`fix_comp_leave_expiration_visibility_and_automation.sql` 適用済み環境に
`add_admin_comp_leave_usage_edit.sql` を適用した後、画面ファイルを公開する。
今回、本番DBへの適用・デプロイは行っていない。
テーブル・列・既存関数の変更はなく、公開RPC 2本と非公開共通関数1本を追加する。
既存の直接登録用日数CHECK（admin_directの正数を許容）が適用済みであることが前提。

## 動作

- 修正RPC: `update_admin_comp_leave_usage(p_application_id,p_employee_id,p_usage_date,p_days,p_note)`。
- 削除RPC: `delete_admin_comp_leave_usage(p_application_id,p_employee_id)`。
- 日付・日数・備考のみを修正。日数は登録と同じ0.01～9999.99、小数2桁まで。
- 対象社員、登録者、登録日時、登録要求UUID、承認情報は保持する。
- `is_leave_manager()` がtrueかつ操作者IDがある場合のみ許可。一般社員・承認管理権限だけの社員・匿名は拒否する。
- `comp_leave` / `approved` / `reviewer_comment`の厳密な`admin_comp_usage:`接頭辞 / 単一日付明細の`admin_direct=true` / 社員ID一致を検証する。
- 申請、日付明細、社員、社員の休日出勤（ID順）、使用割当をロックする。旧割当解除後、既存の`recalculate_holiday_work_record`で使用済みと残数を再集計する。
- 修正時は既存の使用可能日数RPCでsubmitted予約とJSTの当日有効期限を考慮し、修正後の使用日が有効期限内の出勤へ`work_date,id`順に再割当する。revision_requiredに残った割当も追加で保護する。共有の予約計算は変更しない。
- 不足時は例外で全処理がロールバックし、元の日付・備考・割当・残数を保持する。
- 削除は割当を解除して申請を`cancelled`にする論理削除。二重削除・削除後の修正は拒否。履歴カードは「取消」として残り、操作ボタンは表示しない。
- 期限切れの使用分を解除した場合も既存のexpired_daysは変更しない。戻った残数は当日の有効期限フィルターで使用候補から除外され、既存Cronの次回処理対象になる。失効処理そのものは変更しない。
- 修正・削除の操作者と日時は既存のapplications.updated_by_employee_id / updated_at、およびapplication_status_history.changed_by_employee_id / changed_atに記録。履歴コメントに操作種別と修正前後の日付・日数・備考を保存する。
- 成功後は休日出勤・使用可能日数・直接登録履歴・通常使用履歴・失効履歴を部分再取得する。
- UIはカード内編集と削除確認。キャッシュは`staff-portal-v93`。

## 検証

- `tests/admin-comp-usage-edit-db.test.mjs`: PGlite上で6シナリオを実行。FIFO、複数割当、0.01単位、元情報保持、監査、論理削除、二重削除、予約保護、不足時ロールバック、期限切れ・取消除外、社員不一致、通常申請・権限拒否、SQL再適用を確認。
- `tests/admin-comp-usage-edit-ui.test.mjs`: Edgeの非表示ブラウザ、320px幅、模擬RPCで直接登録だけの操作ボタン、編集項目、保存・失敗・キャンセル、削除確認の拒否と承認、再取得、権限制御、横スクロールなしを確認。
- 既存のadmin-comp-usage、admin-comp-expiration-history、admin-personal-employee、comp-leave-reservations、comp-leave-expiration-automationの各テストを実行して成功。
- `git diff --check`成功。
- 実Supabase接続での検証、複数DB接続を使う同時更新競合テストは未実施。ロックは既存の申請→休日出勤ID順に合わせている。

テスト用依存は環境変数`PGLITE_MODULE`、`PLAYWRIGHT_MODULE`で外部配置のモジュールを指定可能。リポジトリへの依存追加は不要。
