# 車両マスタ管理：適用と検証

本番未適用。developの実装準備のみです。

- 前提：`create_driving_report_tables.sql` と `add_employee_default_vehicle.sql` が適用済み。
- 今回適用する新規SQL：`add_vehicle_master_management.sql`。既存SQLを再適用しないでください。
- 実DBのemployees列・RLS・triggerはリポジトリだけでは全定義を確認できません。`employee_default_vehicle_notes.md` の読取確認も参照してください。既存プロフィール保護triggerが新列の更新を拒否する場合も、迂回・無効化しません。
- 既存の通常使用車両の重複がある場合、migrationは全体を停止します。自動解除は行いません。次の読取SQLで車両IDごとの社員を確認できます（今回は本番未実行）。
- migration全体は再実行可能です。既存の `employees_default_vehicle_unique` は、employees.default_vehicle_id単独・即時・検証済み・NULL重複許可のUNIQUEと一致する場合だけ再利用します。別列、遅延評価、NULLS NOT DISTINCT等の異なる定義はエラーにして既存制約を置換しません。関数はCREATE OR REPLACEで同じシグネチャを更新します。

```sql
select default_vehicle_id, array_agg(id order by id) as employee_ids,
       array_agg(name order by id) as employee_names
from public.employees where default_vehicle_id is not null
group by default_vehicle_id having count(*) > 1;
```

## 一意性・競合制御

`employees_default_vehicle_unique` は即時UNIQUE制約。NULLは複数社員に許可し、非NULLは無効社員・無効車両も含め1車両1社員です。RPC以外の更新にも制約が適用されます。既存本人RPCは新migration内で置換し、active/Auth確認とNULL解除を維持します。

本人設定RPCと管理者保存RPCは、同じtransaction advisory lock `726314923` を行ロックより前に取得します。割り当てRPC同士を直列化し、車両のactive確認は共有行ロックで保護します。競合する非RPC更新も、最終的にはUNIQUE制約で重複を拒否します。

管理者は `current_employee_id()` / `is_application_admin()` による既存の本人Auth・active・admin_scope='all'を使用。氏名特例や社員情報の権限変更はありません。

## 管理者RPC

- `admin_get_vehicle_master()`：車両一覧、必要最小限の社員情報、現在の割り当て配列を1つのsnapshotで取得。通常社員・anonは利用不可。
- `admin_save_vehicle_master(p_vehicle, p_assignments, p_expected_assignments, p_deactivate_ids)`：車両登録／編集、明示された社員の割り当て、旧車の無効化を1呼出しで実行。
- `p_assignments` は `[{"employee_id": 2, "vehicle_id": "saved"}, {"employee_id": 3, "vehicle_id": 10}]` 等。`saved`は今回保存する車両、NULLは解除です。
- 社員間交換では両社員を含め、一旦その2人だけをNULLにして再割り当てします。処理中もUNIQUE制約を無効化せず、失敗時は車両の編集・新規作成・解除を含めて全てロールバック。ほかの社員を黙って解除しません。
- 保存前snapshotとの比較で本人設定などの変更を検出。車両編集はupdated_atも比較します。競合時は編集を閉じて再読込してください。
- `vehicle_number`をナンバープレート全表記として入力。既存`registration_number`は上書きしません。全角半角・スペース等をまたぐ表記正規化は今回追加せず、既存UNIQUEに従います。

## 画面と履歴

社員設定→車両マスタ。社員名はvehiclesに重複保存せず、employees.default_vehicle_idから表示します。本人設定の変更は一覧再読み込み、タブ復帰、表示中30秒ごとの再取得で反映します。編集中フォームは元snapshotを維持し、上書き競合を検知します。

買い替えは新規登録時に社員を選び「旧車両を無効化」を選択。交換は既存車両の社員変更時に「交換」を選択。通常の割り当て変更では対象社員の旧車は未割り当てとして残ります。

`p_vehicle.active=false` と `p_deactivate_ids` の両方について、全ての割り当て変更の後に使用社員（無効社員も含む）が残っていないか検証します。残っていれば `deactivated_vehicle_still_assigned` で新車作成・メタデータ更新・全社員の割り当て変更を含め全体をロールバックします。無効化時は同じ保存操作で割り当てを解除するか、買い替えで新車へ移してください。

日報のvehicle_id、snapshot、提出・遅延値は更新しません。物理DELETE、共用車管理、service-worker変更はありません。

## 検証の範囲

- `tests/vehicle-master-db.test.mjs`：隔離PGliteで制約、交換／買い替えの一括処理、失敗ロールバック、権限、本人設定、履歴維持を検証。
- `tests/vehicle-master-ui.test.mjs`：ローカルHTML＋モックAPIで登録・交換・無効化、本人変更の反映、競合エラー、PC／スマホ表示を検証。
- PGliteで18グループ通過。同じ回帰テストを一時PostgreSQL 18.4でも実行し、18グループ通過しました。日本語Windows環境のinitdb制約により、このローカルクラスタだけSQL_ASCII／Cロケールを使用しました。
- `tests/vehicle-master-concurrency.test.mjs`：実PostgreSQLの別接続で、本人同士、非RPC直接更新、管理者交換対本人設定、管理者同士、無効化対本人設定の5ケースを実測。advisory／transactionidのロック待機を観測し、重複・古いsnapshot・無効車両を拒否することを確認。専用テストDBは終了時に削除し、一時サーバーも停止済みです。
- 実Supabase Auth・既存本番triggerとの結合は未検証です。DB一意性はテスト時だけのアプリ判定ではなく常時有効なUNIQUE制約で保証します。
