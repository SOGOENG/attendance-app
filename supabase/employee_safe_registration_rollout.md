# 社員登録・編集 protocol 2（ローカル実装、本番未反映）

2026-10-23の運用方針：登録を継続し、有効な全体管理者だけが登録する。既存編集・使用停止・管理車両・運転日報対象ON/OFFを維持。完全削除は停止。以前の「登録停止を最終構成とする分離導入」は本手順で置き換える。今回の実装・テストは本番SQL実行、Edge配備、main変更の許可を意味しない。

## 状態と復旧範囲

- `auth_creating`：社員はinactive、Auth未紐付け。旧beginの入力検証・操作ID・同一入力照合・共通advisory lockを再利用する。
- Authは未知のランダムパスワード、email未確認、100年のban要求、サーバー専用app_metadataの操作ID付きで作成する。意図した初期パスワードはここでは使わない。パスワード・JWTは台帳やログへ保存しない。
- `auth_bound`：auth.usersの内部メール、app_metadataの操作ID、ban、隔離マーカーをDBで確認して同じ社員に紐付ける。inactiveのまま。
- `releasing`：現在も有効な全体管理者かをDBで再認可し、社員の業務情報・紐付け・指定activeを確定する。これが解放を認可する時点。Edgeが一度だけ初期パスワード・email確認・ban解除・解放マーカーをAuthに送る。
- `completed`：DBが実際のauth.usersで解除とマーカーを確認した後。返却成功はこの状態だけ。レスポンス消失の再送は結果確認であり、再登録・パスワード変更ではない。

解放とDBは分散トランザクションであり同時commitではない。解放直後～完了記録の間にログインできる可能性はあるが、社員の業務情報は先に確定している。管理画面では完了確認まで通常編集対象から除外する。解放認可後の操作者失効で完了記録できない場合は、別の有効な全体管理者が照合する。解放認可commit後の失効とAuth要求を完全に原子的に扱う保証はない。

限定復旧は既存Authの照合・紐付け・必要時の一度だけの解放・完了確認を行う。他の全体管理者も実行でき、元のactor_auth_idを変更せずlast_actorを記録する。新worker tokenで古い処理を無効化する。登録途中社員はtriggerで氏名・権限・active・車両・削除等を保護し、私有RPCの認可済み遷移に一致する変更しか通さない。

**自動復旧しないケース**：Auth作成結果不明で照合0件／不一致、旧方式の未完了記録、Auth解放要求の結果不明でまだ隔離中のケース。元リクエストが後から完了する可能性があるため、同じメールでAuthを再作成したり、解放を再送したりしない。別操作IDでの再登録も禁止。担当者が処理停止・Auth実体・ログを照合し、別レビューの個別復旧へ進める。自動DELETE・台帳削除はない。

Authが明確な400/422を返し、DBでも隔離を確認できる場合だけauth_boundへ戻して入力修正後の限定復旧を許す。timeout・429・5xxには適用しない。解放済みなら復旧は完了確認だけで、パスワードは変更しない。

## 二重登録と制約

同一操作IDの入力差は拒否。同一入力の別IDは既存操作を返す（別操作者の場合は要確認）。同時処理は共通DBロックと操作状態、worker tokenで制御。画面のWeb Locks・操作台帳は補助であり唯一の防止策ではない。

入力一致は本人同一性ではない。同姓同名・表記違い・部署変更を含む本人識別は未解決で、氏名だけで自動統合しない。意図的な同一入力の別人登録は個別確認が必要。旧ブラウザー台帳、旧Auth、旧社員の操作IDを推測で付け替えない。

新規のdriving_report_requiredは既存SQLの既定値false。完了後に全体管理者がON/OFFを編集する。管理車両は既存の車両RPCを利用し、登録履歴をCSVや日報とともに保持する。既存車両の名前不一致は既存仕様どおり拒否し、履歴のある車両の番号・名前を直接書き換えない。

## 共有本番DBでmainを壊さない公開順序

追補：登録有効化には `restrict_employee_anonymous_reads.sql` による匿名社員SELECT遮断も必須。新IDログインの配信・実Auth確認後に、レビュー済み配信SHAを `portal.reviewed_login_revision`、確認結果を `portal.id_login_verified=yes` として同じ適用セッションで宣言する。これは自動配信検証ではない。認証済み/サービス用SELECTの実効権限が変わる構成ではSQL全体が停止する。詳細は `portal_release_readiness.md` を優先する。

直接書込遮断SQLはTRIGGER・REFERENCES・PostgreSQL 17以降のMAINTAINと列REFERENCESも撤回する。service_roleの実効権限は維持し、不明な継承権限は変更せず停止する。登録ゲートは匿名SELECT・直接書込・これらの付与が復活した場合にも新規登録を停止する。

1. 本番の適用済みSQL・社員列・trigger・全RLS/ACL/列ACL/ロール継承・関数所有者/本文・Edge実体・現在mainの社員登録/編集/車両/プロフィール経路を保存して比較する。既存Authの未紐付け・重複・旧登録途中を照合する。リポジトリのmainには旧PATCH経路があり、そのまま直接書込を遮断すると壊れる。
2. **先に隔離環境で**本番相当定義と現行mainを含む移行試験を行う。実Authの作成時ban、email未確認、ログイン/refresh拒否、解放、app_metadataの保護、Auth APIの400/422時の無変更を確認する。SDK/GoTrue実版を固定して確認する。未完了Authが発行済みJWTを持つ旧ケースはbanだけで解決したと扱わない。
3. SQLは `add_employee_management_rpc.sql` → `add_employee_creation_operations.sql` → `add_employee_safe_registration.sql`。未適用分のみを適用し、既存同名定義・所有者・改行ハッシュが未知なら停止。旧操作が未完了ならprotocol 2 migration自体が停止する。`add_employee_driving_report_target.sql`は新規導入経路では不要。新SQLの初期enabled=false、creation_management_enabledは全体管理者だけtrue。既存社員・Authをbackfill/削除せず、SELECT/RLS/直接PATCH権限もこの時点では変えない。
4. **mainへの正式反映が別途許可され、対応画面を配信可能になった作業枠で**、対応済みmain画面とsafe-registration-handlerをimportするbright-serviceを協調切替する。旧createにoperationIdを推測付与する互換処理はない。旧画面・古いタブ・service-workerキャッシュも再読込し、実際の配信JSを確認する。新Edgeだけ先行配備すると旧mainの登録が失敗するため禁止。恒常的な登録停止を最終状態とせず、この移行枠で次項まで完了する。
5. RPC版の編集・本人編集・使用停止・車両・プロフィールを確認し、`employees_service_role_privileges_snapshot.sql`で前後比較しつつ `restrict_employee_direct_writes.sql` を適用する。全クライアントがRPC/Edge経由になってから行う。未知の継承権限やservice_role差分が出たら停止。旧Edgeや別SECURITY DEFINER RPCによる迂回もレビューする。表権限遮断だけで全経路が安全になったと扱わない。
6. `enable_employee_safe_registration.sql`は**最終ゲート**。適用担当者がレビュー済みmainの40桁SHA、実Auth隔離試験完了、旧Auth照合完了をそれぞれ`portal.reviewed_main_revision`、`portal.auth_isolation_verified=yes`、`portal.legacy_auth_reconciled=yes`として同じセッションで明示する必要がある。値は監査上の確認宣言であり実配信を自動証明しない。宣言なし・直接書込権限残存時は失敗する。設定後も直接書込が再許可されれば新規登録はサーバー側で停止する。
7. 有効全体管理者の新規登録、完了社員のログイン、本人/他社員編集、使用停止、車両登録/移動、運転日報対象ON/OFF、日報/月別提出/CSV、各種申請・承認・経理を確認する。登録した社員・車両は本番データとして維持し、テスト後の自動削除をしない。匿名/一般/部署/無効管理者の登録・復旧、完全削除、直接PATCHは拒否されることを確認する。

今回これらの本番作業は実施しない。SQLだけを先行適用してmain互換を保証したり、既存mainを変えずに最終権限遮断できると判断しない。全体管理者本人は編集対象に残すが、自分のactive/admin_scopeを変更した後まで権限が残る保証はない。別の復旧可能な全体管理者を確保する。

障害時は登録ゲートを停止し、既存の社員・車両・操作履歴・Authを保持して照合する。直接PATCH権限の再付与、旧bright-serviceへの単純巻戻し、無条件DELETEで復旧しない。RPC版の安全な編集と既存機能を維持する。

## 根拠・検証の限界

- Supabase公式Admin APIはpassword、app_metadata、ban_durationを扱う：[Auth実装](https://github.com/supabase/auth/blob/master/internal/api/admin.go)、[updateUserById](https://supabase.com/docs/reference/javascript/auth-admin-updateuserbyid)。作成時のbanに関する過去の実装差もあるため、実プロジェクトで隔離確認が必要。
- employee-safe-registration.test.mjs：実SQLをPGliteで実行し、Authはモック。独立した複数DB接続のロック競合や本番GoTrue/JWT/追加triggerを証明するテストではない。
- 既存の社員権限、車両、運転日報、申請のテストも合わせて確認する。以前のhandler.mjs/paused-handler.mjsは履歴・緊急停止の検証用として残すが、通常の本番入口はsafe-registration-handler.mjsのみ。

## 今回の変更ファイルと検証記録

今回追加・変更したファイル（以前からのCSV・管理メニュー等の未コミット変更は保持）：

- 社員画面：`employee-admin.html`、`employee-admin.js`（登録状況照会の操作ID指定、マスク付き復旧入力、入力値の非保存、8文字以上の初期パスワード）。
- Edge：`functions/bright-service/index.ts`、`functions/bright-service/safe-registration-handler.mjs`。SDKは2.49.8に固定。
- SQL：`add_employee_safe_registration.sql`、`enable_employee_safe_registration.sql`。既存の編集・登録操作管理・直接書込遮断SQLは再利用し、旧ファイルを新仕様で無条件上書きしない。
- 文書：本書、`employee_security_rollout.md`、`employee_creation_recovery.md`、`admin_driving_month_status_notes.md`。
- テスト：`tests/employee-safe-registration.test.mjs`、`tests/employee-registration-ui.test.mjs`、`tests/admin-driving-month-db.test.mjs`、`tests/employee-managed-vehicle-db.test.mjs`、`tests/application-rpc-authorization-db.test.mjs`、`tests/bright-service-paused.test.mjs`。

ローカル結果：

- PGlite/モックAuth：新登録8群、既存社員権限8群、月別提出14群、管理車両30群、申請認可11群、合計71群成功。後者3本は新登録SQL適用後の実業務RPCと履歴不変の確認を追加。WindowsのCRLFで既存fixtureが壊れる問題はテスト読込時の改行正規化で修正し、明示的CRLF検証は維持した。
- Chrome/モックAPI：登録・限定復旧、既存社員権限、閲覧専用フォールバック、管理車両編集、給油領収書権限の5本成功。新画面はPC/iPad/iPhone相当・320pxで操作と横はみ出しを検証。初期・復旧パスワードをlocalStorageへ保存しないことも確認。
- 旧handler6群・保持した緊急停止handler、JavaScript構文、git diff --checkも成功。
- 未実施：本番照合、実GoTrueのログイン/ban/解放・JWT/OTPとの結合、Deno実行/型チェック、独立した複数PostgreSQL接続での競合負荷、main/旧タブを含む実配備の協調切替。PGliteの同時リクエスト試験は本番DBの接続間競合を保証しない。
- 結果不明で照合できないAuthは自動復旧の対象外。手動照合の担当・連絡方法、同姓同名/表記違いの識別、旧未完了記録の処理を公開前に確定する。
