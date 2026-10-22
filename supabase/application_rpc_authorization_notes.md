# 申請RPC認可の独立修正（本番未適用）

運転日報の月別管理・社員管理移行とは独立した修正。基礎SQLや月別管理SQLを再適用しない。

## 変更と既存仕様

- cancel_application / reopen_application_draftは、有効なAuth本人を最初に要求し、社員比較をIS DISTINCT FROMにする。取消の本人/全体管理者区分、承認済み取消の管理者制限、再編集の本人限定・差戻し限定は維持。部署管理者や経理に取消権限を追加しない。
- 両入口のPUBLIC/anon EXECUTEを剥奪。authenticated/service_roleの既存EXECUTEを維持。
- recalculate_paid_leave_balance(bigint)は本体を変更せず、PUBLIC/anon/authenticatedの直接EXECUTEを剥奪。所有者と既存service_role EXECUTEを維持する。全体管理者も通常のauthenticated接続から直接は実行できない。
- 所有者権限で呼ぶ既存SECURITY DEFINER処理（承認・取消・初期残数・経理使用登録/修正）の内部実行を維持。内部ヘルパーへのJWT必須条件は追加しない。
- 履歴・残数・日報データ、RLS、trigger、スキーマは変更しない。非認証時はエラーとなるが、正規ユーザーの申請ルールは変更しない。

## 適用前の読み取り確認

1. SQL Editorでapplication_rpc_authorization_preflight.sqlのSELECTだけを実行し、結果を完全なJSON/CSVで保存する。氏名・メール・UUID・業務レコードは取得しない。
2. history_table_exists=true、history_actor_column.exists=true、not_null=trueかを確認する。存在しない/NULL許容なら本番状態が想定と違うためレビューを止める。今回の修正はNOT NULLに頼らず認可するが、本番の制約を推測で扱わない。制約追加やデータ補正は今回行わない。
3. 既存3関数の所有者postgres、SECURITY DEFINER、search_path、本文ハッシュ、引数/既定値、ACLを修正SQLのガードと照合する。2026-10-22取得の本番CRLF本文と、それに完全対応するLF本文のみ許容する。元のACLはpostgres/anon/authenticated/service_roleの4者にEXECUTE、grant optionなし、grantor=postgres。PUBLICやカスタムロールが追加されていれば停止する。
4. 通常画面がrecalculate_paid_leave_balanceを直接呼んでいないこと、未知のEdge/外部バッチ/定期処理がauthenticatedで直接使っていないことを確認する。リポジトリの画面に直接呼出しは見つかっていないが、外部クライアントは未確認。

## 別途承認された本番作業での順序

1. 定義・ACL・所有者を控え、実Authで正常な本人申請/管理者取消/経理残数処理を事前確認する。
2. fix_application_rpc_authorization.sqlをpostgresとして全体で実行する。本文/所有者/ACL/主要属性の未知差分、3関数の混在適用状態、継承由来の不要EXECUTEがあればトランザクションを停止する。ガードを外して通さない。正確な適用済み状態なら再実行できる。
3. preflight SELECTを再実行。取消/再編集はanon=false, authenticated=true, service_role=true。残数再計算はanon=false, authenticated=false, service_role=true。PUBLICのEXECUTEなし、所有者維持を確認する。
4. 架空データを使う隔離/ステージング環境で匿名・無効・未紐付け・他人を拒否し、本人取消/本人再編集、管理者取消、経理の初期残数/使用登録/修正、承認と取消による残数復元を確認する。提出済み運転日報の月ロックは既存どおり拒否することを別途確認する。

失敗時は後続作業を停止し、定義・ACLを再取得する。データ削除やanonへの再GRANTで復旧しない。新たなガード対象外の定義があれば差分migrationを別レビューする。

## 検証と限界

tests/application-rpc-authorization-db.test.mjsをPGliteで実行する。元の本番3関数・ACLはtests/application_rpc_auth_original.sqlに保存し、CRLF再現、元の不正操作と修正後拒否を比較する。基盤テーブル・基本triggerはapplication_management.sqlを使用する。履歴列をNULL許容にした感度テストでも拒否する。

10群成功：修正前再現、CRLF照合・再実行、履歴NULL許容時の認証拒否、本人/管理者の既存ルール、直接再計算拒否とservice_role維持、経理登録/修正/削除・承認/取消の内部再計算、既存月ロックでの取消/再編集拒否、READ ONLY preflight、未知ACL/本文/所有者/継承権限の停止を確認。経理/承認の本番取得定義はtests/application_rpc_auth_callers.sqlを使用する。

既存管理者月別DB13群、経理使用登録UIロジックと申請管理の個人選択ロジックも回帰成功。

実Auth、本番の全trigger/追加制約、独立した複数接続、外部クライアント、実際の月別提出処理からの一連の操作はこのテストだけでは確認できない。本番のNOT NULLはpreflight取得待ち。今回の実装は本番適用・デプロイを含まない。
