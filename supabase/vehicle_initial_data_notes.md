# 車両の初回データ登録

## 適用

本番SupabaseへのSQL適用は未実施。手動適用するファイルは `add_vehicle_initial_data.sql` の1本。既存の車両・通常車両・運転日報・前回メーターRPCがある環境のtable owner（通常postgres）で全体を実行する。既存環境のマイグレーション適用状況は本作業で接続確認していない。

依存する列：vehicles.id/active/vehicle_number/vehicle_name、employees.id/auth_user_id/active/default_vehicle_id、driving_reports.vehicle_id/employee_id/report_date/status/driving_status/end_odometer、driving_refuels.driving_report_id/refueled_at/odometer_km/liters/fuel_station/payment_method。既存current_employee_id、is_application_adminを使用する。RPC所有者にはこれらをRLSで欠落なく読める権限が必要。

このSQLは新規テーブル作成と既存RPCの置換を含む。同一構造のテーブルがある場合は登録済みデータを維持して再実行できる。IF NOT EXISTSだけで済ませず、列・型・NOT NULL・PK/FK/CHECK・既定値・所有者・追加ポリシー/トリガーを確認し、不一致はトランザクションを停止する。互換性のない関数シグネチャが既にある場合もCREATE OR REPLACEで停止し、削除して作り直す処理はない。既存の基礎マイグレーションを後から再適用してRPCを旧定義に戻さないこと。

適用中は初期値テーブルをACCESS EXCLUSIVEでロックするため、短時間の待ちが発生し得る。途中で失敗した場合はトランザクションをROLLBACKしてから原因を確認する。任意の異なる構造・所有者・独自拡張へ自動移行するSQLではない。

## 保存と認可

- 新規 `vehicle_initial_data`：vehicle_idを主キーとし、車両ごとに1件。架空の日報・給油は作成しない。
- 基準日と前月最終メーターが必須。給油情報は日付・メーター・量の3つをセットで登録するか、すべて省略する。給油所・支払方法は任意、金額なし。
- 基準日の翌日以降の日報にのみ使用する。20日締めの開始月は前の20日を画面の初期値にする。未来基準日、基準日後の給油、最終メーターを超える前回給油メーター、不正精度は拒否する。
- created_by/created_atは維持。updated_by/updated_atとrevisionを更新。登録・更新社員IDはJWTに紐付く有効社員から導出する。フォームで指定不可。
- 通常社員の利用資格は、有効車両かつ他社員の通常車両でなく、自分の通常車両または本人の今日以前の運転履歴があること。これは既存の前回メーターの通常車両・利用履歴という資格に合わせた設計。訂正は登録本人だけ。車両の引継ぎ先社員による既存初期値の訂正は不可。
- 全体管理者は既存is_application_adminで判定し、全車両（無効車両を含む）の確認・登録・訂正が可能。氏名を認可条件に埋め込まない。既存の鈴木 和弘さんの全体管理者設定を使用する。
- 新規テーブルはRLS有効、クライアントの直接SELECT/INSERT/UPDATE/DELETE権限なし。許可ポリシー追加なし。既存テーブルのRLS/権限は変更しない。
- SECURITY DEFINERは空search_path・完全修飾名・サーバー側認可を使用。anon/public/service_roleへEXECUTEを開放しない。
- 保存は既存の車両割当RPCと同じadvisory lockで直列化し、社員・車両をロック後に資格を再確認。revision一致が必須で、二重作成・古い画面からの上書きを拒否する。通信結果不明時は再読み込みが必要。

## RPC

- `can_use_vehicle_initial_data(bigint)`：資格判定。真偽値のみ。
- `my_initial_data_vehicles()`：資格のある車両の選択肢。
- `get_vehicle_initial_data(bigint,date)`：初期値・監査情報・訂正可否・過去正式日報の有無・前回給油の参照情報。
- `save_vehicle_initial_data(bigint,date,numeric,date,numeric,numeric,text,text,bigint)`：登録・訂正。最後の引数は既読revision、新規時はnull。
- `previous_vehicle_end_odometer(bigint,date)`：戻り値numericを維持して置換。既存のメーター参照資格（通常車両または本人利用履歴）を維持し、全体管理者を追加。

## 履歴の優先順位

前回メーターは既存RPC同様、対象日より前の運転あり日報の最新日の帰着メーターを優先する。status=submittedに限らず保存済み下書きも含める。月別方式では月末提出まで下書きであるため、下書きを除外すると月内の引継ぎが初期値・前月値に戻る。新しい下書きと古い正式日報がある場合も最新の保存済み日付を優先する。同じ最新日に複数の異なる値があればnull。過去の正式日報があるが利用可能なメーターがない場合もnull。いずれも初期値へ戻して隠さない。利用可能な履歴も過去正式日報もなければ、基準日が対象日より前の初期値を返す。

本番適用前レビューでsubmitted限定による引継ぎ退行を発見し、既存の検索条件を復元した。下書きの保存内容自体は変更せず、既存の日報に保存された出発メーター・手入力は自動上書きしない。同日・未来日報、帰着メーター未入力の日報は候補にしない。これは入力画面の参照仕様であり、正式CSVや提出判定を下書きへ拡張するものではない。

前回給油は対象日より前の正式日報の給油を日時・ID降順で取得し、なければ基準日が対象日より前の初期給油を返す。これは日報入力画面の参照情報で、燃費の自動計算や正式CSVへの統合は行わない。同時刻の給油はID降順の1件表示であり、物理的な給油順序の確定ではない。

## 画面

`driving-initial-data.html` / `.js` は既存の認証・日報CSSを使用する本人向け画面。基準日、最終メーター、前回給油情報、作成・更新者と時刻を表示し、同画面で訂正可能。別社員が登録した値は参照のみ。

`driving-initial-notice.js`を日報画面へ組み込み、選択車両に過去日報のメーター・正式日報・初期値がなければ登録を案内する。get_vehicle_initial_dataのhas_meter_historyは下書き込みのメーター履歴、has_historyは従来どおり正式日報の有無。既登録の場合は確認・訂正へのリンクを出す。別タブで開くため、日報の未保存入力を失わない。登録後は日報を再読み込みする。正式履歴と初期値の前回給油を区別して表示する。SQL未適用・参照権限なし・通信失敗でも既存の入力・下書き・提出は止めない。

管理者の月別提出状況・CSV・Excel・A表/A裏・提出処理・領収書・既存データには変更なし。

## 検証

`tests/vehicle-initial-data-db.test.mjs`：隔離PGliteで実SQLを適用し、未登録、フォールバック、訂正・revision競合、他社員・無効社員・未紐付け・匿名拒否、直接テーブルアクセス拒否、給油省略と不正値、下書きと正式履歴の優先、同日メーター競合、実給油優先、引継ぎ先の訂正拒否、全体管理者の操作を確認する。本番へ接続しない。

`tests/vehicle-initial-data-ui.test.mjs`：ローカルChrome＋模擬APIで保存・訂正・給油省略・入力不備・参照のみ・revision競合・390px表示・案内の状態遷移を検証する。意図的なHTTP409以外のコンソールエラー・実行時エラーを検出する。

既存日報・提出・給油等のUIテストの模擬APIに、新しい参照RPCの応答のみ追加した。PGLITE_MODULE、PLAYWRIGHT_MODULE、BROWSER_PATHは既存テストと同様にローカル依存を指定可能。

実行結果：隔離DB12群成功。新画面UI成功（競合テスト用の意図的なHTTP409以外にコンソールエラーなし）。既存の日報UI・日別提出UI・月別提出UI・領収書UI・領収書経理UIが成功。給油専用UIテストは104行目の保存待ちでタイムアウトした。同じテストへ変更前HEADのHTML/JSを配信しても同じ箇所で再現したため、既存テストの未解消事項として記録し、本機能に合わせた期待値の緩和や既存給油処理の変更はしていない。実機スマホ・本番接続は未検証。

## 本番適用前レビューによる追加検証

隔離DB16群成功。application_management.sqlのcurrent_employee_id/is_application_adminをそのまま読み込んで検証し、有効・Auth紐付け・admin_scope=allのみを全体管理者と確認した。部署管理者・tool_admin・無効な全体管理者・未紐付け・未認証は全体管理者にならない。is_application_admin定義自体は変更していない。本番の関数定義・鈴木 和弘さんの社員レコードの実値は未接続のため未確認。

初回適用・登録データありの2回再実行・不整合構造での停止とロールバック、下書き引継ぎ・古い正式日報より新しい下書き優先・メーター空欄/同日/未来の除外を確認。新規RPCにはrow_security=offを設定し、所有者のRLS回避権限が不足する場合に行を隠して初期値へフォールバックせずエラーにする。これは既存テーブルのRLSを変更する設定ではない。
