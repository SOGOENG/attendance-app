# 初回データ登録：本番適用前の確認

本作業では本番へ接続していない。本番とリポジトリが一致するという判定は未完了であり、現時点の本番適用判定は保留。

## SELECTの実行手順

1. 本番SupabaseのSQL Editorで、プロジェクトが会社用の対象プロジェクトであることを確認する。current_databaseだけではプロジェクトを識別できないため、ダッシュボードのプロジェクト名・参照IDも確認する。
2. 適用予定の所有者ロール（通常postgres）を選び、`vehicle_initial_data_preflight.sql`の全体を実行する。単一のSELECTで、業務データ・業務RPCは参照/呼び出しせず、カタログの構造・定義・権限だけを取得する。DDL、更新、削除、ロック、SET、通知は含まない。
3. 1行の`vehicle_initial_data_preflight`のJSON全体をローカルへ保存する。例えばGit除外済み`local-test-data/vehicle-initial-preflight.json`を使う。省略表示のコピーは避ける。SQL EditorのJSONエクスポートが利用可能ならそれでもよい。関数定義とセキュリティ設定を含むため、コミットや外部公開はしない。
4. 以下の項目を照合する。SELECTの成功や列のOKだけでは適用可とは判断しない。

## 判定条件

| 出力項目 | 確認条件 |
|---|---|
| required_columns | MISSINGがないこと。TYPE_REVIEWは基礎型の相違として個別確認。varchar/enum/domain等が互換かどうかを自動承認しない。numericの精度はactual_typeで確認する |
| required_functions | requiredの関数があること。newの4関数がないのは初回適用前なら正常 |
| functions_all_overloads | 同名の別引数関数も含めて確認。既存関数の引数名・型・戻り値がCREATE OR REPLACE可能か確認。RPCの曖昧なオーバーロードがないこと |
| is_application_admin定義 | auth.uidとemployees.auth_user_idの対応、有効社員、admin_scope=allという条件。対象SQLはこの関数を変更しない |
| current_employee_id定義 | 同じAuth紐付けと有効社員条件で本人IDを返すこと |
| previous_vehicle_end_odometer定義 | 引数p_vehicle_id bigint/p_report_date date、戻り値numeric。下書きを含む最新の過去日報のメーターを読む既存仕様と比較する |
| 車両割当RPC定義 | set_my_default_vehicle、admin_save_vehicle_master、admin_set_employee_managed_vehicleの適用済み定義と、advisory lock 726314923の使用を確認。割当更新経路が別実装なら競合保護を追加確認する |
| tables/roles/table_privileges | 適用ロールが参照先を読めること。RPC所有者がsuperuser/BYPASSRLS、または対象テーブル所有者かつFORCE RLSなしなど、完全読み取りが可能なこと。SELECT権限だけではRLS回避を保証しない |
| 新規作成・置換権限 | publicのCREATE、参照先のREFERENCES、既存関数の所有者、既存初期値テーブルの所有者を確認。既存初期値テーブルは適用ロール自身が所有者であることをSQLが要求する |
| 既存vehicle_initial_data | 存在しなければ正常。存在する場合は13列の順序・型・NOT NULL・既定値・PK/FK/CHECKを適用SQLの検査条件と照合。独自ポリシー/ユーザートリガーがあれば適用SQLが停止する |
| constraints/indexes | vehicles.id、employees.idの参照可能なPK/UNIQUE、および割当制約を確認。履歴検索インデックスも確認する。大量履歴の実行時間はカタログだけでは確定しない |
| policies/table_privileges/column_acl/function_execute | 現在のRLSと実効権限を記録。初期値テーブルの直接アクセスは適用SQLで剥奪される。既存の追加権限・列単位ACLがあれば個別確認する |
| default_privileges | 新しいテーブル/関数が意図しない他ロールへ自動公開されないこと。対象SQLで剥奪するPUBLIC/anon/authenticated/service_role以外への付与にも注意する |
| ddl_event_triggers | 適用時のDDLに反応する独自イベントトリガーがあれば、その副作用を確認する。本SELECTは実行しない |

本番の鈴木 和弘さんが有効・Auth紐付け済み・admin_scope=allであるかは、カタログだけでは分からない。ダッシュボード等で本人レコードを読み取り確認する必要がある。本ファイルでは氏名・Auth UUID・連絡先・日報・初期値の実値を取得しない。

## 現時点の結論

リポジトリ内の既存定義と隔離DBテストに対しては整合している。本番の照会結果をまだ取得していないため、「本番適用可能」とは確定しない。上記SELECTの結果と管理者レコードの確認が揃ってから判定する。本番適用・データ変更・削除・commit・pushは実施していない。
