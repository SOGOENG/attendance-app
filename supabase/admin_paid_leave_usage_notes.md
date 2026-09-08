# 管理者の有給使用直接登録

未適用。`add_admin_paid_leave_usage.sql` はレビュー後に検証DBで実行する。
既存の application_management / leave_manager_balance_permissions の導入を前提とする。

- 新規テーブル・カラムは追加しない。既存RLS、通常申請承認、残数計算関数、初期残数登録RPCは変更しない。
- 登録・履歴参照用の2つのRPCだけを追加。認証済みユーザーに実行権限を与え、内部で既存の `is_leave_manager()` を必ず検証する。
- `paid_leave_balances` を使用日の4月始まり年度でロックし、残数を再計算・確認してから `paid_leave_balance_transactions` に登録する。
- 通常承認と同じ `transaction_type='application_usage'`、使用日数の負数を記録し、既存 `recalculate_paid_leave_balance()` を呼ぶ。使用済み日数にも計上される。
- 直接登録は `application_id=NULL`、`source_key=admin_paid_usage:YYYY-MM-DD:要求UUID` として区別する。使用日は既存source_keyに構造化して保持し、履歴RPCが日付として返す。備考はreason、登録者はcreated_by_employee_id、登録日時はcreated_at。社員はbalance_id経由で特定する。
- 同じ要求の再送は既存unique(balance_id,source_key)と残数行ロックにより二重計上を防ぐ。通常承認も同じ残数行をロックする。
- 使用日数は正数・小数2桁まで。基準日以前の使用は通常承認と同じく二重取込防止のため拒否する。
- 初期残数登録 `set_paid_leave_opening_balance()` のopening取引とは異なるsource_keyなので上書きしない。ただし後日の経理取込は通常申請と同様、取込期間の二重計上に注意して既存運用に従う。
- 画面の上部にある「現在残数」は既存どおり現在年度。直接登録フォーム直上には使用日の年度の残数を明示する。成功後は両方と履歴を再取得する。
- 管理者直接登録履歴と通常申請履歴は別見出しで表示する。直接登録者が無効社員となって名前を取得できない場合も登録者IDは表示する。

実DBの全DDLは未取得。適用前にtransaction_typeのCHECK、application_idのNULL許可、source_keyの長さ、既存トリガー、既存RPCの定義がリポジトリと一致することを確認する。
`admin_paid_leave_usage_verify.sql` は検証DB用で、残数・再送・履歴・残数超過・基準日・0日・権限・既存再計算を検証する。変更はロールバックするがシーケンス値は進む場合がある。未実行。

代休については現リポジトリに直接使用登録の実装が見つからない。既存 `holiday_work_records`、`comp_leave_dates`、`comp_leave_allocations`、`recalculate_holiday_work_record()` および通常承認経路は今回変更していない。
