# 管理者用月別提出状況（ローカル実装・本番未適用）

2026-10-23更新：社員登録を継続するprotocol 2の移行は **employee_safe_registration_rollout.md** を参照。以下の社員登録停止版Edgeを前提とする手順は当時の分離導入履歴であり、新しい社員登録の公開手順としては使用しない。月別提出状況そのもののSQLは別の適用対象。

## 対象設定

employees.driving_report_requiredをboolean NOT NULL DEFAULT falseで追加する。既存社員もOFFから開始し、出勤簿対象・所属・通常車両・過去日報から推測しない。既存の列がある場合は値を上書きせず、型/既定値/NOT NULLが異なれば適用を停止する。

全体管理者が社員管理で各社員を開き、対象名簿を確認して「運転日報対象」をONにして保存する。保存は既存admin_edit_employee→非公開employee_edit_internal経由。部署管理者用の許可列には追加せず、送信されても拒否する。本人が全体管理者であれば自分の設定も変更できる。社員登録・完全削除停止は維持し、新規登録時の設定経路は追加しない。

一覧は**現在ONの社員全員**が対象で、使用停止社員も自動除外しない。退職時のOFFは管理者が判断する。履歴付き名簿ではないため、ON/OFFの変更は過去月の一覧にも影響する。OFFにしても既存提出・日報・正式CSVは削除/変更しない。CSVの名簿確認仕様、本人の入力/提出資格は今回変更しない。

## 画面・権限

settings-admin.htmlに全体管理者だけへメニューを表示し、driving-report-status-admin.htmlで対象月と社員一覧を表示する。締め月は前年/月をまたいでも前月21日〜当月20日。月途中も閲覧可能。提出有無はdriving_report_month_submissionsを正とし、提出日時はJST表示。

社員を選択して日付別の状態・理由を閲覧する。代理入力/編集/提出へのリンクやRPCは追加しない。全体管理者の「自分の日別状況」は対象OFFでも参照可能。admin_driving_month_daysは全体管理者が非対象・無効社員も確認できる。部署管理者・一般社員・無効管理者・未紐付け・匿名には管理者RPCを許可しない。service_roleにも新管理者入口のEXECUTEは付与しない。

概要は50人単位でページ取得し、対象集合/表示名等のroster_tokenと総数が変われば停止して再読込を案内する。日報保存の瞬間まで全ページを同一トランザクションに固定するものではない。初期OFFで0人の場合は「全員提出済み」と表示しない。

## 安全な共通化

add_admin_driving_month_status.sqlは、休日修正版check_driving_report_monthと運転前チェック版driving_report_validate_submissionの**正確な既知prosrcハッシュと適用所有者**を検査する。不一致なら全トランザクションを停止する。見知らぬ本番定義や整形差異を無理に置き換えず、まず差分レビューする。新規関数名が想定外の本体/所有者で使用済みでも停止する。

月別の休日・全日/半日休暇・勤務・既存日報の判定はdriving_check_month_internalへ移し、本人用入口はJWT本人IDだけを渡す。入力検証の本人チェックは既存入口に残し、検証本体だけをdriving_report_validate_fields_internalへ移す。本人用入口の引数・所有者・ACLを維持する。JWT/GUC書換えによる代理実行は行わない。

新規内部関数はPUBLIC/anon/authenticatedへ公開しない。既存SECURITY INVOKER validatorのservice_role実行を維持するため、フィールド検証だけのdriving_report_validate_fields_internalにはservice_roleのEXECUTEを明示付与する。この関数はSECURITY INVOKER・読取検証のみで本人認可は既存入口に残す。社員/月別取得の内部関数・管理者入口はservice_roleへ付与しない。独自default privilegesによるカスタムロール付与も除去し、管理者入口だけauthenticatedへEXECUTEを付与する。既存ヘルパーis_application_admin/is_leave_managerは変更しない。既存提出RPC・ロック・RLS・テーブルGRANT、CSV・車両・申請処理は変更しない。

件数分類は日別RPC結果だけから行う。昨日以前の未入力/入力未完了を記入忘れ、未知エラーや勤務/休暇矛盾を要確認として分離。本日は入力待ち、未来日は対象外。下書きでも検証済みなら入力完了・月別提出待ち。提出済み月は要対応0。分類は本人用表示との対応を隔離DBで検証する。

## 本番適用に必要な順序（今回実施しない）

本番照合2026-10-22では社員編集RPCと社員作成操作管理が未導入。今回は社員作成操作管理・補償・復旧機能を導入しない。`add_employee_creation_operations.sql` は適用不要。既存の実験的handler.mjsは保持するが本番入口からimportしない。

1. 本番の社員管理HTML/JS、employeesを書き込むRPC/Edge、trigger、ACLを保存・照合する。本番画面・全書き込みRPC・現在のEdge配備状態は未確認。旧画面への依存が分からない場合は本番移行を開始しない。
2. 社員編集RPCが未導入の今回の本番では **add_employee_management_rpc.sql** を新規導入する。対象列も初期OFFで追加し、creation_enabled/creation_management_enabledはfalse。未知の既存同名RPC、列型/既定値違いは停止する。実験的な社員作成SQLには依存しない。RPC導入済みの別環境向けadd_employee_driving_report_target.sqlは今回の新規経路では不要。
3. bright-serviceをindex.ts＋paused-handler.mjsで配備し、作成/完全削除が直接HTTPでも拒否されることを確認する。社員管理HTML/JSと依存JSを反映し、編集RPCによる本人全体管理者・他社員・部署の限定編集を確認する。登録操作管理UIは非表示でcreation_statusを呼ばない。旧クライアントや別タブの直接書き込みは次の制限で拒否されるため、移行時間を調整する。
4. **restrict_employee_direct_writes.sql**を適用。SELECT・RLS・service_role・既存RPC権限を維持し、PUBLIC/anon/authenticatedの表/列書き込みを閉じる。継承権限が残る場合は停止。社員管理・本人プロフィール・車両設定・申請/経理を確認し、他の書き込み経路が残る場合は管理者機能公開を止める。
5. **add_admin_driving_month_status.sql**をpostgres所有者で適用。本番validatorのCRLFハッシュ8d06f197a323fc46ad28e716a62335b6を明示許容。LF版と改行正規化後に完全一致していることを照合済み。新たな不一致は許容しない。既存本人RPC所有者/ACL（validatorのservice_role EXECUTEを含む）を維持する。
6. settings-admin.html、新規管理者画面HTML/CSS/JSを反映する。driving-report-period.js、driving-report-month-followup.jsが必要。社員設定を反映後、全体管理者が確認した社員だけ個別ON。本人OFF・0人・部署/一般拒否・月別提出・CSVを確認する。

本番作業前に全定義/権限を保存する。失敗時は新管理者画面を止め、社員編集はRPC版を維持する。復旧のために匿名書き込みを再許可したり、旧validatorだけを再適用したりしない。復元が必要な場合は共通化前の本人関数2本とACLを一組として別途レビューする。対象列や業務履歴を削除しない。

共通化後に旧休日修正/旧validatorを再適用すると判定が分岐するため禁止。将来のルール変更は内部共通処理と対応テストを更新する。復旧時も既存データ・提出レコードを削除しない。元の関数定義・ACLを控え、新しい管理画面を停止したうえで整合した関数セットを戻す手順を個別レビューする。

## 検証と残件

- admin-driving-month-db.test.mjs：実リポジトリのテーブル・本人チェック・validator・月別提出をPGliteへ適用。本人応答の完全一致、休日・全日/半日休暇・勤務不確定・休日出勤・未完了、管理者集計との一致、対象初期OFF/編集、本人権限、権限拒否、カスタムdefault grants除去、所有者権限不足時の停止、実月別提出とロック、未知定義の適用停止を検証。
- admin-driving-month-ui.test.mjs：実Chrome＋模擬API、社員一覧/ページング、日別理由、本人OFF、0人、年越し、SQL未適用、XSS対策、PC/390/320px。
- 既存社員編集・車両・領収書権限・本人月別提出・CSV出力テストを回帰確認する。
- 取得済み本番JSONで既存本人2関数の本体・所有者と依存テーブルのpostgres SELECTを確認済み。ただし実Auth/実機・複数接続負荷、移行時の本番状態、対象名簿の設定は未確認。隔離テスト成功だけで本番適用可とは判断しない。

ローカル実行結果：新規管理者DB13群・新規管理者UI成功。既存社員管理DB8群、CSV出力DB19群、社員編集UI（対象ON/OFF含む）、車両管理UI、領収書権限UI、本人月別提出UIが成功。既存の本人月別一覧改善に関する未コミットファイルとsupabase/.temp/は保持したまま実施。

分離版の追加検証：本番CRLF validatorとservice_role ACLを再現し、社員作成操作管理テーブル/RPCなしで編集・対象設定・直接書込拒否・本人/管理者月別処理を実行。社員RPC再適用、未知定義の停止、カスタムdefault grantsの除去を確認。bright-service-paused.test.mjsは停止専用本番入口の認可と、Auth管理/書込/RPCを一切呼ばないことを模擬SDKで検証。employee-security-uiはcreation_management_enabled=falseで照会なし・編集可能を確認。CSV DB19群・プロフィール5群・既存社員管理DB8群・関連UI回帰成功。本番環境の検証ではない。

service_role互換性の回帰検証：本番CRLF版の実呼出し結果を保存し、修正前ACLによる42501を再現後、修正SQLで正常系/業務エラーが一致することを検証。再適用後の内部関数ACL、本人制限、SECURITY INVOKER、一般社員/全体管理者/anonの内部直接実行拒否も検証する。実Auth/本番での利用経路は未確認。
