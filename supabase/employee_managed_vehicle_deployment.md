# 社員中心の管理車両：本番適用手順（未実行）

今回の作業はdevelopでの実装・隔離テストのみです。本番SQL実行、公開、コミット、pushは行っていません。

## 構成

- 日報は引き続きemployee_idに所属し、employee_id＋report_dateで保存・検索します。車両を変更しても履歴を別社員へ付け替えません。
- 現在の管理車両の唯一の参照はemployees.default_vehicle_id。1社員1台・1車両1社員の既存制約とRLSを維持します。
- 社員編集は電話番号直下で車両番号・車両名を直接入力し「管理車両を保存」。社員プロフィール保存とは独立しています。新規社員作成後に、編集画面から車両を登録してください。
- 新規番号は新車として登録。旧管理車両は無効化して保持します。同じ番号は既存レコードを再利用し、既存車両の番号・名前を上書きしません。車両名の不一致はエラーにします。
- 社員間移動は移動元の氏名と「移動後は未設定」を確認画面に表示。キャンセル時は通信しません。RPCは期待する移動元IDと割り当てsnapshotを再確認し、移動元解除・移動先割り当て・旧車無効化を一括で行います。
- 独立車両マスタへの導線を撤去。vehicle-admin.html/js/cssは削除せず保持しています。

## DB変更

`add_employee_managed_vehicle.sql`を新設。

1. driving_reports.vehicle_name_snapshot（NULL許可）を追加。
2. 新規／日報上の車両変更時に番号・名前を保存するtriggerを追加。既存のprepare triggerの後に動き、認証・監査・提出・遅延処理は置換しません。
3. 全体管理者限定の `admin_set_employee_managed_vehicle` RPCを追加。共通advisory lockと既存admin_save_vehicle_masterを再利用。社員の他項目は更新しません。

既存日報を更新するSQLやバックフィルはありません。導入前の車両名はNULLを保持し、画面では「車両名未保存」と表示します。現在名を当時名と推測して埋めません。以後の新規日報はDB側で番号・名前を記録し、クライアントのsnapshot値は信用しません。

未登録番号のRPC呼出しは `id: null, expected_updated_at: null` を明示します。既存admin_save_vehicle_masterでは `->>` がSQL NULLになりINSERT分岐へ進むため、既存行のupdated_at比較は実行しません。同番号が存在する場合だけID・updated_atを渡して再利用します。両経路は実PostgreSQLで検証済みです。

triggerは同じBEFORE ROW INSERT/UPDATEなので名前順に `driving_report_prepare` → `driving_report_vehicle_snapshot_prepare`。前者は本人・識別子・監査・提出日時・遅延・番号snapshot等、後者は番号／名前snapshotだけを担当します。後者もSECURITY DEFINER、空search_path、本人確認を持ち、authenticated/anon/PUBLICの直接EXECUTEは許可しません。triggerからの実行は可能です。

migration冒頭で既存prepare triggerの関数・BEFORE ROW INSERT/UPDATE・有効状態と、前提の管理者RPCの存在を確認します。不一致時は停止します。ただし本番にしかない別triggerの全体的な互換性までは自動判定しません。

## 適用順序

1. 実DBの適用済みmigration、既存trigger・RLS、バックアップを確認してください。既存employeesの全定義はリポジトリだけでは確定できません。
2. 前提はcreate_driving_report_tables.sql、add_employee_default_vehicle.sql、add_driving_report_submission.sqlが適用済みであること。適用済みのCREATE TABLE／ADD COLUMN SQLを再実行しないでください。
3. `add_vehicle_master_management.sql`が未適用なら先に適用。既存重複は自動解除せず停止します。事前確認用SQLはvehicle_master_management_notes.mdを参照してください。
4. 同じテーブル所有者で `add_employee_managed_vehicle.sql` 全体を一度だけ適用します。既存オブジェクトとの衝突時は停止します。末尾のNOTIFYでAPI schema cacheを更新します。
5. SQL適用成功後に画面ファイルを反映してください。先に画面だけ反映すると新RPCが存在しないため管理車両の保存が失敗します。service-workerは今回変更していません。
6. 本人／全体管理者／通常社員で権限、新規日報初期選択、保存済み日報優先、移動元の確認表示を確認してください。

## 検証

- employee-managed-vehicle-db.test.mjs：隔離PGliteおよび実PostgreSQL 18.4で19グループ通過。新規登録、既存車両再利用、買い替えと他社員への非影響、移動元確認、旧日報不変、snapshot偽装拒否・更新・保持、マスタ名称変更後の保持、提出済み本体／明細の変更拒否、既存NULL・提出日時・遅延値維持を確認。RLS・既存table grant・元prepare関数定義がmigration前後で不変であることも比較しました。
- vehicle-master-db.test.mjs：既存18グループ通過。重複制約、交換・買い替え、無効化の整合性、再実行を回帰確認。
- employee-edit-vehicle-ui.test.mjs／driving-report-ui.test.mjs：ローカルHTML＋モックAPI。直接入力、移動元氏名・未設定の確認とキャンセル、既存車両名の上書き拒否、通常車両の自動選択、既存draft・submitted・保存済みNULL優先、無効設定の除外、PC・スマホ表示を確認。
- 本番固有のAuth・trigger結合は未検証です。新RPCは既存の共通ロックとUNIQUE制約を利用します。新RPCを含む複数PostgreSQL接続の追加実測は今回行っていません。

実PostgreSQL検証の再実行例（本番URLは受け取らずlocalhost固定、使い捨てローカルサーバー専用）：

```text
POSTGRES_MODULE=/path/to/postgres/src/index.js
POSTGRES_TEST_PORT=65439
node tests/employee-managed-vehicle-db.test.mjs
```

専用テストDBを作成し終了時に削除します。今回のWindows検証クラスタは初期化時の日本語環境制約によりSQL_ASCII/Cロケールを使用。一時サーバーは検証後停止しました。本番の全列型・関数所有者・追加trigger・実Auth構成は未取得のため、本番そのものとの互換性確認が済んだという意味ではありません。
