# 工具名マスタと初期移行

## 役割

tool_catalog は新しい工具名を管理画面から追加するためのマスタ。点検対象・点検区分は新規登録の初期値であり、実機の正しい設定や既存 tools の統一ルールではない。実際の点検設定と管理番号は tools に保持する。

## Supabaseでの実行順

既存の本人登録・本人編集・工具名訂正RPCが導入済みの環境を対象とする。以前のSQLファイルは再適用しない。

1. tool_catalog_preflight.sql：読み取り専用。auto_migrate=false を手動確認対象として先に表示し、理由・元の区分・正規化後の区分・接頭辞・実管理番号を一覧化する。
2. add_tool_catalog.sql：マスタ作成、RLS、一意制約、初期データ登録のみ。既存 tools に対する INSERT / UPDATE / DELETE はない。
3. tool_catalog_registration.sql：採番・登録・既存編集のRPCと新規登録時の有効マスタ検証トリガーを定義する。このSQL自体は登録・編集RPCを呼ばず、既存 tools データを変更しない。
4. tool_catalog_verify.sql：採番・RLS・既存データ不変の検証。postgresロールで実行。検証用マスタ行はロールバックする（identityシーケンスの消費は戻らない）。他の利用者が工具を変更すると不変チェックが失敗するため、操作のない時間帯で実行する。
5. SQL適用後にフロントを配信し、PWAを再読み込み。CACHE_NAME は staff-portal-v79。

任意の事前テストとして tests/tool-catalog-migration.test.sql を実行できる。一時テーブルだけを使い、表記ゆれ・混在・要確認・複数接頭辞・旋盤・再実行を検証する。

## 自動移行と手動確認

大分類＋工具名が空でなく、管理番号が有効な接頭辞＋数値形式であり、点検対象（NULL不可）と正規化後の点検区分（全件NULLは許容）が一意なら自動登録する。通常工具の接頭辞は1種類であることを要求する。

比較とマスタへの初期値出力でのみ、3P → 3p、二重絶縁 → double_insulated とする。3p、double_insulated はそのまま。他の値や元の tools は変更しない。

点検設定の混在（NULLと値の混在も含む）、点検対象NULL、通常工具の複数接頭辞、管理番号欠落・未対応形式、空の分類・名前、未対応区分は手動確認。要確認も正式区分にはせず手動確認に回す。安全値の推測、trueへの統一、多数決は行わない。

手動確認対象はマスタに自動登録せず、その名前だけをスキップする。他の安全な名前の移行は継続する。管理者は一覧を確認して、管理画面で新規登録時の初期値を決めて追加する。既存 tools を修正して移行条件を満たす運用は行わない。

登録済みマスタは ON CONFLICT DO NOTHING で保持する。再実行しても重複せず、管理者が変更した初期値・接頭辞・無効状態を上書きしない。既存マスタがある手動確認対象も削除・変更しない。tools にない固定候補を勝手に補完する処理は廃止した。

## 旋盤

SB-1IN、SB-2IN、SB-3IN、SB-4IN は同じ旋盤の正常なサイズ別採番であり、複数接頭辞の不整合ではない。この4系列だけならマスタの code_prefix には明示的な識別値 SB を登録する。採番ではこの値を使わず、従来どおり選択サイズの SB-サイズ を優先する。点検設定まで混在する場合は、その理由で手動確認となる。

通常工具はマスタの接頭辞と一致する既存 tools.management_code の最大番号＋1。旋盤も対象サイズ系列の最大番号＋1。廃棄・無効の工具番号も計算に含む。既存の advisory transaction lock (712034,1) と管理番号 UNIQUE 制約を維持する。番号の振り直しはしない。

## フロント・権限・既存データ

管理者の新規登録は、名前選択時にマスタの点検対象・区分を初期表示し、フォームの個別入力を保存する。本人の新規登録にも点検対象の切替を設け、区分とともに変更可能にした。明示的な false / NULL も初期値で上書きしない。本人登録RPCの p_inspection_required は省略可能で、旧クライアントの呼び出しは引き続き可能。旧10引数シグネチャをCASCADEなしで削除して11引数に置き換え、PostgRESTのオーバーロードの曖昧さを避ける。

マスタ未導入時は従来の登録候補・登録ルールへ戻る。空のマスタや権限・通信エラーでは無効候補を復活させない。マスタ導入済み環境では上記SQLをすべて適用してから新フロントを利用する。

通常の本人編集は登録済み工具の設定を表示する。マスタから再設定せず、3P・二重絶縁・要確認などの既存表記も変更しない限り保持する。工具名訂正の履歴制限は変更しない。

active=false は新規登録候補から除外するだけ。検索候補はマスタと実工具の和集合で、無効化・改名後も過去工具の検索・詳細・修正・履歴を保持する。貸出・移動・返却・return_shared_tool・shared-tool-state.js・QR・点検履歴・バッテリー履歴・協力業者の既存データ・半年点検処理は変更しない。

RLSは authenticated に SELECT、既存 is_tool_registration_admin() の条件（有効な本人社員、admin_scope が all または tool_admin）に合うユーザーにのみ INSERT / UPDATE。DELETE権限なし。本人としてログイン中の管理者も同じ判定で利用できる。

## 今回の調整ファイル

SQL：tool_catalog_preflight.sql、add_tool_catalog.sql、tool_catalog_registration.sql（新設）、tool_catalog_verify.sql。

フロント：personal-tools.html、personal-tool-registration.js、tool-master.html、tool-master.js、tool-catalog-admin.js、service-worker.js。

テスト：tests/tool-catalog-migration.test.sql（新設）、tests/tool-catalog.test.mjs、tests/personal-tool-registration.test.mjs、tests/personal-tool-update.test.mjs、tests/tool-detail-status.test.mjs。

## 検証範囲

JavaScriptでは工具名マスタ、本人登録、本人編集、共有工具状態、共有工具返却、工具詳細の6本を実行し、すべて成功。JavaScript構文チェックと git diff --check も成功。SQLの実行環境・Supabase接続は利用できないため、実データの手動確認対象件数、SQL実行、同時登録試験、実ブラウザの操作確認は未実施。SQL検証ファイルは実Supabaseで別途実行する。
