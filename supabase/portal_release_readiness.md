# 綜合ポータル ローカル実装と本番切替の確認

develop上での実装・ローカル検証用。公開・main変更・本番SQL/Edge操作を承認する文書ではない。既存の未コミット変更とstashを保持し、今回の作業でも操作しない。

## 実装の範囲

- ID＋既存パスワード認証。ログイン前の社員一覧照会なし、JWTで本人情報確認後だけ従来セッション形式で保存。一般/部署/全体/休暇管理権限を維持。画面上の認証失敗は共通メッセージ。アカウントやパスワードは変更しない。
- 社員編集は期待値照合付きRPC。全体管理者本人も編集対象。部署管理者の許可項目を制限。RPC未導入の404/PGRST202だけは正規SELECTによる閲覧専用。その他の認証/認可エラーはフォールバックしない。
- 操作ID付き登録、Auth隔離・一度だけの解放・DBでの完了照合・限定復旧。登録途中の編集/車両/削除をtriggerで保護。完全削除は停止。曖昧なAuth結果は再作成せず手動照合へ止める。
- 管理車両番号/名前の登録、競合検知付き移動、元社員からの割当解除。過去の日報/車両履歴は保持。既存番号の異なる車両名を無条件上書きしない。
- 運転日報対象ON/OFFは全体管理者用編集RPC。月別一覧は対象者集合に従う。OFFは既存日報/提出/CSVを削除しない。現在の名簿設定が過去月にも反映される仕様で、月ごとの対象者履歴ではない。
- 本人月別確認・提出・提出済み月の編集ロック、管理者の月別/日別閲覧、正式CSVは月別提出済み全員分。出力時に再取得・確認し、取得不能/提出者変更時には出力停止/再確認。
- 管理メニューはヒヤリハットと予定管理の間で開閉。全体管理者に3項目、経理担当者には給油領収書だけ表示。サーバーの権限判定に従う。

## 追加した権限の閉鎖

`restrict_employee_anonymous_reads.sql` は匿名のテーブル/列SELECTとPUBLIC由来SELECTを撤回する。既存の認証済みSELECT・service_role SELECT・RLS・データは維持。不明な継承や認証済みSELECTへの影響があれば全体rollback。配信済みIDログインのSHAと実Auth確認の宣言なしでは停止する。宣言は人による確認記録であり、配信やAuthを自動検証しない。

`restrict_employee_direct_writes.sql` は匿名/認証済みクライアントのINSERT/UPDATE/DELETE/TRUNCATEに加えTRIGGER/REFERENCES/MAINTAIN、列書込/REFERENCESも撤回する。service_roleの実効権限を前後比較して維持し、不明な継承権限は停止する。

登録の最終ゲートは匿名SELECTと不要権限が閉じている場合だけ有効。後から該当権限が再付与されれば新規登録は停止する。これらは他の公開schema/ビュー/RPCやEdgeの認可を自動証明するものではない。

## 本番の既知状態と保全

10/23の保存済み監査：社員35人、有効全体管理者5人、Auth紐付け不整合0。編集/登録RPC・登録台帳/設定・driving_report_required列は未導入。車両主要RPCはdevelopの対応定義と本文一致。employeesはRLS無効、anon/authenticatedに広い権限。これらは取得時点の証拠なので適用直前に差分を確認する。

ユーザー報告により、10/23にDBバックアップ取得・複製・SHA256一致を確認済みとして扱う。こちらでファイル内容や復元可能性を追加認定したものではない。Storage原本保存と復元試験は未実施・今回後回し。画像を失う変更/削除やStorage migrationは公開範囲に含めない。ハッシュ一致は復元成功の証明ではない。

## 承認後の切替順序（今回未実行）

1. 最終成果物をレビューし、必要なファイルを一式にする。未追跡SQL/JSが配信・移行から漏れないようにする。適用直前のDB定義/ACL、Edge実体、配信リビジョンを保存する。本番への変更は別途明示承認を得る。
2. 新ログインを先に配信し、実Authで全体管理者本人・部署・一般の正規ログインを確認する。既存アカウント/パスワードを変更しない。旧タブ・キャッシュ・ホーム画面追加アプリを更新し、実配信版を確認する。
3. `restrict_employee_anonymous_reads.sql` をレビューして適用。`portal.reviewed_login_revision`（配信SHA40桁）、`portal.id_login_verified=yes`を同じセッションで明示する。本人7列のauthenticated SELECTを維持する。匿名読取拒否と新ログイン成功を再確認し、社員管理・申請・出勤簿・工具の参照も確認する。
4. 社員管理の書込を一時停止し、進行中の登録を照合する。未導入分だけ `add_employee_management_rpc.sql` → `add_employee_creation_operations.sql` → `add_employee_safe_registration.sql`。対象列は最初のSQLに含まれる。同名不明定義・所有者/ハッシュ不一致・旧未完了操作はガードを外さず停止。
5. 社員画面（車両・給油権限・操作台帳の依存JSも含む）とsafe-registration版bright-serviceを協調切替する。SQLは旧登録RPCの実行権限も撤回するため旧Edgeと併用しない。新Edgeだけの先行配備、旧画面の操作IDなし登録を許容する互換処理はしない。登録ゲートはまだOFF。
6. 本人/他社員編集、使用停止、車両、対象者ON/OFFを確認。全クライアントをRPC/Edgeへ移した後で `restrict_employee_direct_writes.sql`。service_roleと正規の既存RPCを維持し、直接PATCH・不要権限を拒否する。
7. 独立した実Auth隔離/解放の検証と旧Auth照合を完了したうえで `enable_employee_safe_registration.sql`。`portal.reviewed_main_revision`（SHA40桁）、`portal.auth_isolation_verified=yes`、`portal.legacy_auth_reconciled=yes`を同じセッションで明示。新規登録・既存ログイン・本人編集・業務回帰を確認する。登録した正式社員/車両は保持する。
8. 運転日報の管理者月別SQLは別単位として既存check/validator等の定義ハッシュを照合する。`add_admin_driving_month_status.sql` の依存・共通化・service_role互換性を確認して適用し、旧validator/休日修正を後から上書きしない。対象者ONは業務上の対象者を確認して設定する。初期false/0人を全員提出済み扱いしない。

申請の `fix_application_rpc_authorization.sql` は別の既存脆弱経路対策。本番監査では修正前の3関数とanon EXECUTEが残っていた。社員テーブルACLの撤回だけでは修正されない。既存の認可修正preflight/ガードと回帰を確認した別適用単位にする。

## 今回の検証と公開前の限界

ローカルのPGlite/モックAPI/Windowsブラウザーで検証する。テストは本番URLへSQLを送らず、ブラウザーテストはAPIをモックで置き換える。実行結果は作業完了時の報告と照合する。

今回の再検証では下記43本が成功（重複再実行は加算しない）。構文チェックと `git diff --check` も成功。

- 社員/権限/車両/監査DB：employee-access-cutover-db、employee-safe-registration、employee-security-db、employee-managed-vehicle-db、employee-default-vehicle-db、employee-migration-preflight。
- 日報/申請等のDB・ロジック：application-rpc-authorization-db、admin-driving-month-db、driving-report-csv-db、driving-report-csv、driving-report-month-mode、driving-report-month-followup、driving-report-workday-rpc、driving-report-draft-test、admin-personal-employee。
- 既存機能のDB・ロジック：tool-catalog-active-read-db、shared-tool-checkout-db、application-attendance-overwrite、shared-tool-state、shared-tool-return、shared-tool-checkout、personal-tool-update、personal-tool-registration、fuel-receipts-server。
- 社員/管理画面ブラウザー：employee-security-ui、employee-readonly-ui、employee-edit-vehicle-ui、employee-fuel-receipt-role-ui、employee-registration-ui、login-private-ui、admin-driving-month-ui、driving-admin-menu-ui、driving-csv-roster-ui。
- 日報/既存機能ブラウザー：driving-report-month-ui、driving-report-month-submit-ui、driving-report-month-followup-ui、shared-tool-search-display、driving-report-ui、driving-report-submission-ui、driving-report-refuels-ui、driving-report-workday-ui、fuel-receipts-ui、fuel-receipts-admin-ui。

ファイルは原則 `tests/<名前>.test.mjs`、下書きだけは `tests/driving-report-draft-test.mjs`。WindowsのCRLFによる工具fixture抽出失敗、Python実行名、数値入力未確定のままスクリーンショットがスクロールする給油テスト条件を修正して再成功。実データの処理を緩める修正ではない。

`fuel-receipts-sdk.test.mjs` は実SDKの依存パスが未設定で起動できず、上記成功数に含めない。Deno専用環境とネイティブPostgreSQL複数接続の試験も成功扱いにしない。

公開前に残るもの：実GoTrueのban/ログイン/refresh/OTP/解放と失効の検証、独立PostgreSQL接続でのロック競合、DenoでのEdge型/実行確認、iPhone/iPad実機Safari、実配備/キャッシュの切替、実バックアップからの復元確認。本番のAuth試行回数制限も確認し、CAPTCHAを有効にするなら先にtoken送信を実装する。画面の共通エラーは生のAuth HTTP応答/時間差を一定にする保証ではない。

全体管理者と残数管理者は既存どおり別。全体管理者でもis_leave_manager=falseなら有給/代休残数管理を表示しない。この権限分離を今回無条件に緩めない。運用方針の変更は別判断とする。

本人の全体管理者属性をmigrationで変更しない。自己編集は可能だが、意図的な自己停止/自己降格後も権限を残す仕組みは設けない。別の有効な復旧担当全体管理者を確保する。

障害時は新規登録ゲートを止め、操作IDとAuth実体を照合。結果不明の再作成・再解放、データ削除、匿名SELECT/直接PATCHの安易な再付与で復旧しない。既存機能を保つ安全な修正を優先し、共有DB全体の時点復元は他業務更新への影響を別途評価する。
