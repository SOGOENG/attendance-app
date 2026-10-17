# previous_vehicle_end_odometer 実PostgreSQL検証結果

実施日: 2026-10-17（日本時間）。全項目PASS。対象RPCの修正は不要だった。
本番DBへの接続・実行なし。コミット・pushなし。

## 環境と範囲

- 公式ソースから構築した PostgreSQL 17.6 / macOS arm64。
- データディレクトリ: `/private/tmp/attendance-pg-isolated-data`。
- TCP無効（listen_addresses空）、専用Unixソケット `/private/tmp/attendance-pg-socket`、port 55439。
- DB: `attendance_rpc_isolated_test`。検証後サーバー停止。
- リポジトリの create_driving_report_tables.sql / add_employee_default_vehicle.sql / 対象SQLを実適用。
- current_employee_id / is_application_admin は application_management.sql の定義をコピー。
- employees / sites とその周辺認証基盤だけ最小構成で再現。社員は4名、車両6台、日報9件の架空データ。
- auth.uid()は request.jwt.claims / request.jwt.claim.sub を読むテスト関数。
- RPCは非所有者の authenticated LOGINへ直接接続して実行（SUPERUSER/BYPASSRLSなし）。
- anon LOGINでも直接接続。RPCのEXECUTE拒否を確認。
- Supabase AuthによるJWT署名検証やPostgRESTのHTTP経路、本番のロール・所有者構成そのものは検証対象外。

## 結果

| 条件 | 実測結果 |
|---|---|
| 本人の通常使用車両1 | 123.0 |
| 本人の過去日報で使用した車両2 | 222.0 |
| 他社員だけが使用した車両3 | 42501 vehicle_odometer_access_denied |
| 未使用車両4 | 42501 vehicle_odometer_access_denied |
| 許可車両に他社員が記録した最新の帰着値 | 車両1=123.0、車両2=222.0 |
| 車両1→2の切替 | 123.0→222.0（車両別の値のみ） |
| 過去日指定、指定日当日・以降の記録を除外 | 111.0 |
| 前回記録なし | NULL |
| 無効車両5・存在しない車両・NULL車両 | NULL |
| 同じ最新日の異なる帰着値（600と666） | NULL |
| 本人の使用日より前の日付を指定 | 42501 |
| 未来日・NULL日 | invalid_report_date |
| authenticated接続、JWT情報なし | active_employee_required |
| 無効社員のJWT情報 | active_employee_required |
| anonの実接続 | permission denied for function |
| RLSで他社員の日報を直接SELECT | 0件（本人の3件だけ見える） |
| 戻り値・関数設定・権限 | numeric / SECURITY DEFINER / 空search_path / anon実行不可 |
| 一時employees/driving_reportsによる参照先差し替え | 値は123.0のまま、未許可車両は42501のまま |
| RPC実行前後の日報比較 | 全9行不変 |

## 再実行用SQL

隔離した空DB専用。setupはロール・テーブルを作成するため共有DBで実行しないこと。

1. 所有者で `tests/previous-vehicle-end-odometer-setup.sql`。
2. authenticatedとして新規接続し `tests/previous-vehicle-end-odometer-db.test.sql`。
3. anonとして新規接続し `tests/previous-vehicle-end-odometer-anon.test.sql`。

今回の接続はすべて psql -X -h /private/tmp/attendance-pg-socket -p 55439
-d attendance_rpc_isolated_test -v ON_ERROR_STOP=1 で固定し、-Uのみ各ロールに変更した。
認証・匿名テストともexit code 0。RPC定義は supabase/add_previous_vehicle_end_odometer.sql が全文。

この制限は本人の保存済み下書きも利用履歴とみなす。本人が日報を作成できる車両について、
管理者承認を必要とする厳密な車両アクセス制御ではない。
