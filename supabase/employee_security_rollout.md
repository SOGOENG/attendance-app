# employees書き込み保護（ローカル準備・本番未適用）

2026-10-23更新：登録継続を必須とする運用方針の実装・公開手順は **employee_safe_registration_rollout.md** を参照。以下の登録停止を最終構成とする分離導入は履歴であり、新しい公開判断には使用しない。

## 今回の分離導入（優先する手順）

今回の適用手順は **admin_driving_month_status_notes.md** の「本番適用に必要な順序」を正とする。社員作成操作管理・補償・復旧機能は今回導入しない。add_employee_creation_operations.sqlは不要。index.tsはpaused-handler.mjsをimportし、社員登録・完全削除・操作管理照会を停止する。handler.mjsとその実験的テストは保存するが本番入口では使用しない。

社員管理はadd_employee_management_rpc.sqlで新規導入し、対象列driving_report_requiredは初期OFF。creation_management_enabled=falseで登録状況UIも非表示。RPC版画面/停止版Edgeの確認後にrestrict_employee_direct_writes.sqlを適用する。社員管理の本番画面・既存書き込みRPC・Edge配備状況が未確認のため、本番作業前に確認すること。

以下は従来の操作管理を含む計画・検証履歴。今回の本番SQL一覧として使わない。

## 従来の公開判断

社員登録・完全削除はサーバーと画面で停止する。未紐付けAuthにも許可される読取RLSがあるため、登録再開は未承認。社員編集と直接書込保護を先行する場合は、登録停止の機能制限を含めて適用判断する。詳細はemployee_creation_recovery.md。

## 範囲と認可

2026-10-22共有の本番bright-service全文を基準に、既存のPOST/create、社員ID由来内部メール、employees→Auth→紐付けの順を維持する。index.tsは起動部、handler.mjsはテスト可能な本体。元のnone以外という認可を、有効・一意なAuth紐付け・admin_scope=allへ限定。deleteはAuth/DB操作前に拒否。既存社員やAuthアカウントを削除するコードはない。

社員編集はadmin_edit_employee／department_edit_employeeへ移行。全体管理者は本人を含む全社員の従来の編集項目を一括更新可能。本人の降格・停止も禁止しないため、その後の管理操作は拒否され得る。自己完全削除は今回すべての完全削除とともに停止。

部署管理者はadmin_scopeが工事部・技術部・営業部・総務部のいずれかで、対象のdepartmentと一致する場合のみ。対象はadmin_scope=none、is_leave_manager=false、fuel_receipt_rolesにemployee_idの行がない社員。工具管理の判定元はpersonal_tool_registration.sqlのadmin_scope in (all,tool_admin)。提出対象はattendance_required/improvement_required/near_miss_required。氏名とこの3列以外の受信を拒否する。追加管理権限について、この3つ以外の本番独自権限があれば適用せず確認する。

employee_edit_contextは画面の操作資格と対象IDを返すが、保存時には再認可する。追加の領収書権限が検証中に付与されないよう、部署用更新はfuel_receipt_rolesをSHAREロックする。車両割当の共通advisory lockと社員行ロックも使用。既存車両RPC自体は変更しない。競合時には失敗して再読込を求める。複数実PostgreSQL接続による競合実測は別途必要。

is_application_admin/is_leave_manager、申請承認、経理、車両、日報、初回データ登録の処理は変更しない。領収書管理権限の設定は既存の独立処理を維持し、社員保存後の権限保存失敗は部分成功として画面に残す。

## 社員作成と未解決の復旧ケース

add_employee_creation_operations.sqlが操作ID・操作者Auth ID・対象社員ID・パスワードを含まない許可項目・状態を保存する。service_roleだけが開始/完了RPCを実行し、RPC内でも有効な全体管理者を検証する。操作記録の直接アクセスは付与しない。両RPCは単一DBトランザクションとして処理される。

- 開始: 操作IDを排他確認してemployeesをactive=false/Auth未紐付けで作成し、employee_createdを同時記録。
- Auth作成: 既存同様に社員ID由来メールと入力パスワードで作成。
- 完了: 紐付けと要求されたactive値、completedを一括確定。
- 失敗: recovery_requiredと固定エラーコードを記録。記録自体の失敗もrecoveryRecorded=falseで返す。秘密を含むSDKエラーやリクエストはログへ出さない。

本番の補償DELETEは成否未確認かつCASCADE/triggerによる副作用が未解決だったため、今回は自動補償削除を実装しない。Auth作成/紐付け失敗時は削除せず、要復旧として明示する。完了レスポンスの消失は、完了状態の照合で成功を確認できた場合だけ成功を返す。

同一操作IDの再送は、完了済みなら結果を返し、それ以外は409として新たなAuth作成を行わない。payload/操作者が違う再送も拒否。同じpayloadの別IDは既存操作として扱い、別操作者の同内容は要確認として拒否する。表記違い等による同一人の検出は行わない。画面は操作者・入力フィンガープリント別に操作IDを保持し、Web Locksでタブ間を直列化する。パスワード・入力本文は保存しない。同一入力の別IDはDBでも照合する。旧キーは保持する。

**復旧未実装:** Auth作成後のプロセス停止、開始/完了レスポンス消失、権限失効、DB通信断、Authの部分成功。停止した操作の自動再開・期限による再実行はしない。DB所有者が操作IDと社員ID由来メールでAuth/社員実状態を照合し、既存のFK/triggerを確認したうえで個別復旧する。復旧手順を確定するまでは別操作IDで再登録しない。操作記録削除・pending操作IDのクリアを自動で行わない。パスワードを復旧記録に残さない。

登録再開条件: この手動対応の担当・連絡方法を決め、作成中社員のinactive状態を既存コードが許容することを確認する。隔離試験用の成功経路ではAuth作成後のアカウント自体をbanする処理はなく、inactive社員のアプリ認可とAuthの認証可否は別である。他の既存APIのactive検証まで一律に保証しないため、本番用起動コードは登録停止とする。操作ID用ストレージが使えない場合は登録開始前に失敗する。

## 適用順序（承認後の別作業）

1. 現在のemployees定義・ACL/列ACL・ロール継承・trigger、service_roleとRPC所有者権限、bright-service公開版と画面を控える。既存プロフィール列・is_leave_manager・fuel_receipt_rolesの本番定義と所有者による完全参照を確認。
2. add_employee_management_rpc.sql、add_employee_creation_operations.sqlをレビュー済み所有者で適用。creation_operationsは初回適用専用。無条件の再適用はしない。新規関数/テーブルへの独自default privilegesも確認する。これらは未適用のSQLを前提としているため、旧版が既に適用済みなら差分migrationを別途作成する。
3. bright-serviceの登録/削除停止版を反映。旧画面も登録できなくなる。新規Authを作らないことと管理者用creation_statusを確認する。通常運用を止めた作業枠で進める。
4. employee-admin.html、employee-admin.js、employee-creation-state.jsを反映して再読み込みを案内。全体管理者/部署管理者の社員編集、登録停止、復旧状況照会を確認。登録成功経路は模擬環境のみ。
5. employees_service_role_privileges_snapshot.sqlで変更前JSONを保存してからrestrict_employee_direct_writes.sqlを適用。PUBLIC/anon/authenticatedのテーブル・列書込権限を除去。未知の継承権限が残れば例外で全体をロールバックする。service_roleの実効テーブル/列権限が変わる場合も例外で全体を戻す。共有ロールの権限を推測で変更しない。
6. 同じsnapshot SELECTを再実行し、共通オブジェクトのservice_role実効権限・シーケンス・関数EXECUTEを比較。SELECT・既存RPCと直接書込拒否を確認する。SQLの成功だけで公開可とはしない。

RLSの有効化/SELECT制限、既存データの修正・削除、FK変更は含まない。TRUNCATE試験は隔離DBのみ。本番にはテスト社員を無断作成しない。

## 復旧

権限剥奪SQL失敗時はROLLBACKし、原因の継承権限を確認。反映後の画面/RPC不具合は書込禁止を維持して修正する。旧画面だけへ戻すとPATCHが失敗する。旧bright-serviceへ単純に戻すと広い認可と完全削除が復活するため、認可限定/削除停止版を維持する。緊急のACL復元は控えた定義を基準に別途判断し、自動再GRANTはしない。作成された操作記録・社員をロールバック目的で自動削除しない。

## ローカル検証

- tests/employee-security-db.test.mjs: PGlite、社員編集認可、追加権限除外、本人編集、競合、作成操作ID・別ID同内容の照合・状態照会・部分成功、直接権限/列権限剥奪、継承権限時の停止、SELECT/service_role/既存ヘルパー・RPC維持。
- tests/bright-service.test.mjs: JWT・全体管理者、削除拒否、作成順序・再送・Auth/紐付け/記録失敗・完了応答消失。模擬SDKのみ。
- tests/employee-security-ui.test.mjs: 実Chrome＋模擬API、部署画面、RPC、競合、削除非表示、登録成功後の即時編集・車両設定導線、複数タブ、入力/操作者別操作ID、復旧照会、登録停止、パスワード非保存。
- 既存employee-edit-vehicle-ui／employee-fuel-receipt-role-uiと初回データ登録DBテストを回帰確認。

実Authとの統合、実PostgreSQL複数接続、未知の本番trigger・追加権限は未検証。本番適用・デプロイは今回実施しない。

### 最終レビュー修正後の検証結果

- employee-security-db: 8群成功。実リポジトリのcurrent_employee_id/is_application_admin/is_leave_managerとset_my_default_vehicleを読み込み、権限剥奪後も通常車両設定と全体管理者/経理判定を確認。service_roleがPUBLIC由来だけの書込権限を失う構成では適用SQLが停止し、全体をロールバックすることを確認。
- bright-service: 6群成功。通常起動の登録停止、管理者限定の状態照会、隔離試験用成功/失敗/再送経路を確認。
- employee-security-ui成功。共有コンテキストの2タブで同じ操作ID、別操作者/入力で異なる操作ID、模擬登録成功直後の編集と車両設定導線、復旧照会と登録停止を確認。
- employee-edit-vehicle-ui、employee-fuel-receipt-role-ui、settings-default-vehicle-ui成功。
- vehicle-initial-data-db 20群、employee-managed-vehicle-db 29群、comp-leave-reservations、application-attendance-overwrite、admin-comp-usage-edit-db成功。既存テストの回帰結果であり、全テストを新しい本番同等構成へ結合したものではない。
- employees_service_role_privileges_snapshot.sqlとemployees_creation_recovery_audit.sqlは隔離DBのREAD ONLYトランザクションで構文・出力を確認。本番では未実行。
- tool_catalog_readの実リポジトリ定義を隔離DBへ読み込み、未紐付けAuthの読取が許可されることを再現。既存業務RLSは今回変更せず、登録停止を維持する。
