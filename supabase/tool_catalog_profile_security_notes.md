# 工具名マスタ読取・本人プロフィールの限定修正

ローカル準備のみ。本番SQL実行・デプロイは未実施。社員登録・完全削除停止は変更しない。

## 工具名マスタ

新規環境用add_tool_catalog.sqlの読取条件を有効社員のAuth紐付けへ変更。既存環境にはrestrict_tool_catalog_reads.sqlのみを使用し、元ファイルの種データ移行を再実行しない。

tool_catalog_readを変更し、authenticated向けの制限ポリシーtool_catalog_active_employee_read_guardも追加する。別のSELECT/ALL許可ポリシーがあっても有効社員条件を迂回させない。有効な一般社員・工具管理者・全体管理者は無効マスタを含む全列を引き続き参照できる。INSERT/UPDATE条件・採番・工具登録RPC・toolsデータ・service_role権限は変更しない。

適用前にtool_catalog_read_security_preflight.sql全体を対象プロジェクトのレビュー済み所有者で実行し、JSONを非公開で保存する。単一SELECTで、業務データを取得・変更しない。tool_catalogのSELECT/ALLポリシーをすべて確認し、RLS有効・標準readポリシー・既存guardの有無と定義・anonの列権限/継承権限・authenticatedによるemployees参照とauthスキーマ使用を照合する。カスタム制限ポリシーが正常利用を拒否する可能性も確認する。未知の定義なら適用を保留する。

適用SQLはRLS無効、readポリシー不在/種別不一致、anonの実効読取権限、guardの種別/対象ロール不一致があれば停止する。RLS回避ロールや未収録SECURITY DEFINER関数の参照まで、このguardが保護するとは判断しない。本番での確認は未実施。

## 本人プロフィール

update-own-profileはid,activeを取得し、Auth紐付け重複の検出後にactive=trueを要求する。初回検索をactiveで絞って無効な重複行を隠す変更はしない。UPDATEはID・Auth UUID・active=trueで絞り、保存直前に停止された場合の0件更新も403とする。電話/メールの許可リスト・入力検証・成功レスポンスは維持する。画面変更やemployeesへの直接UPDATE許可は不要。

## 検証結果と残件

- tool-catalog-active-read-db: 隔離PGliteで5群成功。匿名/未紐付け/無効の拒否、全有効区分の全列読取、追加許可ポリシーの迂回拒否、管理者登録/更新、候補RPC、新規/既存環境、再実行・データ不変を確認。preflightもREAD ONLYで実行成功。
- update-own-profile: 実際のTypeScriptをNodeの型除去機能で読み込み、模擬SDKで5群成功。正常保存、認証、未紐付け、無効、重複、保存直前停止、許可項目・入力値を確認。
- employee-security-db 8群、bright-service 6群、personal-tool-registration、personal-tool-update、settings-default-vehicle-ui成功。登録・完全削除のサーバー停止も維持。
- tool-catalog.test.mjsは前半の画面/API検証に成功するが、種データ用BEGIN SEED QUERYマーカーの欠落で後半が停止する。HEADの変更前add_tool_catalog.sqlでも同じ失敗を再現。今回その既存テストや種データ移行は変更しない。
- 実Auth、デプロイ済み関数、実際の本番ACL/全ポリシーとの結合は未検証。工具個体テーブルtoolsや他APIの追加調査・改修は今回行わない。これらの限定修正だけで社員登録を再開しない。
