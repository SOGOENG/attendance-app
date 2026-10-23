# 社員管理・本番移行の追加監査

本番では未実行。`employee_migration_readonly_preflight.sql` は1文のSELECTのみ。既存の業務RPC、動的SQL、SET、DDL/DML、ロック取得、採番関数は呼ばない。読み取りに必要な負荷は発生するため、利用の少ない時間に実行する。権限やデータを変更する移行SQLとは別のファイルである。

## SQL Editorでの実行と結果の受け渡し

1. 対象が本番プロジェクト `fgmvmbjnoyagnpygcbky` であることを確認する。本SQL自体はproject refを証明しない。
2. SQL Editorを開き、監査SQLの全内容だけを貼り付ける。`postgres`など、既に社員・Auth・カタログの完全な読み取り権限を持つ確認済みのロールを使用する。この監査のために新しい権限を付与しない。
3. 全体を1回実行する。結果は **1行・1列 `employee_migration_preflight` のJSON**。画面の省略表示をそのままコピーせず、セルの完全なJSONをコピーしてUTF-8の `.json` に保存する。セルコピーで省略される場合は結果全体をCSVでダウンロードする。1列CSVのままでもCodexで解析できる。
4. 保存先はDownloads等のリポジトリ外とし、`.json` または `.csv` をCodexに渡す。プロジェクトref・実行日時・実行ロールも知らせる。スクリーンショットだけでは本文・ACL照合ができない。
5. 定義文・default・policy・関数configには、既存コードに埋め込まれた個人情報や秘密情報が含まれる可能性がある。共有前に確認する。監査自体は社員名・メール値・社員ID・Auth UUID・パスワード・トークン・app_metadataの行データを出力しない。

必須の既存オブジェクトは `public.employees(id,auth_user_id,active,admin_scope)` と `auth.users(id,email)`。不足や権限拒否では失敗をそのまま報告し、権限付与や業務関数の実行で回避しない。任意の登録管理テーブル・RPC・対象列がなくても監査は成功する。

## JSONで確認する項目

| キー | 確認内容 |
| --- | --- |
| runtime.visibility | employees/auth.users両方の完全可視性。falseの場合、件数を全件数と判断しない。falseは必ず不完全という断定ではなく、カタログから完全性を証明できない状態 |
| tables / columns | 登録台帳・設定の存在、社員列・型・NOT NULL・default・identity、車両・経理権限テーブル |
| constraints / indexes | 社員ID採番方式、Authの一意性、社員からのFKと社員を参照するFK、CHECK・一意索引・有効性 |
| triggers / functions | pg_catalog上の内部triggerを含む定義と有効状態、関数本文・所有者・設定・ハッシュ・EXECUTE。期待するRPC名は全overloadを列挙 |
| effective_privileges / employee_column_access | anon/authenticated/service_roleの実効権限。列単位SELECT/INSERT/UPDATE、schema USAGEを含む |
| table_acl_sources / column_acl_sources / role_memberships / default_privileges | PUBLIC付与、列ACL、継承元、将来オブジェクト向けdefault ACL |
| policies / anonymous_read_assessment | RLSとポリシー、anonがRLSによる制限なしで直接読めるか。HTTP経由で取得したという意味ではない |
| public_views / functions | ビュー・マテリアライズドビューとpublicのSECURITY DEFINER経由の別経路。未知の関数も一覧化 |
| employee_auth_aggregate | 紐付けなし、Auth実体なし、重複、内部メール形式との不一致、社員に紐付かないポータル用Auth、有効全体管理者と一意な既存Authとの対応件数 |

Authの不一致件数は調査対象であり削除対象ではない。別形式の既存メールは正当な運用の可能性がある。UUIDやIDの一覧は出さず、担当者が別の制限された手順で本人確認する。

## この1本で分からないこと

- 登録台帳と設定は**カタログだけ**を調べる。未導入でも成功し、動的SQLも使わない構成のため、存在する場合の未完了件数・state別件数・enabled値は読まない。存在が確認された場合は、列定義を確認してから集計専用SELECTを追加レビューする。`requested`の氏名等や操作IDを一括出力しない。
- Edgeの本番ソース・version・JWT検証設定・環境設定、Auth設定とGoTrue実版、バックアップ/PITR状態はSQLから取得しない。Dashboardの読み取り情報またはManagement APIのGETで確認する。secretの値を共有しない。
- PostgREST公開schema、ゲートウェイ設定、他schemaのビュー/RPC、関数の動的・間接呼び出しの完全な到達性は別レビュー。関数/ビューは定義取得のみで実行しない。SQL Editorからanonを模した実データ取得も行わない。
- Authが存在することは、本人がログインできること、ban・OTP・refresh・JWTが安全なことを証明しない。個々の管理者本人の利用可否も件数だけでは確定しない。

## 公開前の残る作業と停止条件

1. 本監査で同名RPC・所有者・定義を照合し、不明な定義を上書きしない。登録管理テーブルが見つかったら未完了の旧操作を照合する。information_schemaのtrigger 0件だけで判断しない。
2. 現行bright-serviceと社員関連Edge（プロフィール更新・パスワード再発行・自己プロフィール等）の実体を保存・レビューする。service_roleやSECURITY DEFINERによる迂回は直接書き込み遮断だけでは閉じない。完全削除の別経路も確認する。
3. **匿名閲覧を公開条件として扱う。** anonのschema USAGEとSELECT権限がありRLS無効なら、UIを隠してもDBの閲覧制御にならない。現行mainの `login.js` はログイン前に公開キーで `employees?select=id,name,department,active,admin_scope,is_leave_manager,auth_user_id&active=eq.true` を読み、社員選択と認証後のAuth ID照合に使っていることをソースで確認した。したがってanon SELECTの単純撤回はログインを壊す。ログイン前の社員名一覧を続けるか、社員ID入力等へ変更してログイン後に本人情報を取得するかを決める。一覧を残す場合も、専用の最小列・active限定の閲覧経路を用意し、Auth IDや管理権限等を匿名で公開する必要は再検討する。認証後の本人照合はサーバーで安全に維持する。自己プロフィール・社員一覧・申請等の参照経路も確認し、anon SELECTを閉じるための別修正を設計・検証する。現行の書き込み遮断SQLはSELECTもRLSも直さない。RLSを無計画に有効化したり、anon SELECTだけ先行撤回してmainを壊したりしない。
4. `add_employee_management_rpc.sql` → `add_employee_creation_operations.sql` → `add_employee_safe_registration.sql` の依存を照合する。最後のSQLは旧begin/finishの権限撤回を含むので、対応Edgeと切替枠を揃える。新規導入ではdriving対象列の追加は最初のSQLに含まれる。既存社員はfalseとなるため対象者を業務上確定する。
5. 対応画面・全依存JSと新Edgeを協調切替し、旧タブ/キャッシュ/developからの操作も止める。現行mainの操作IDなし登録と直接PATCHは新構成と併用できない。全書込経路をRPC/Edgeへ移行後に `restrict_employee_direct_writes.sql`、最後に `enable_employee_safe_registration.sql`。匿名閲覧対策も承認済みの切替計画に含める。
6. 本人編集・他社員編集・使用停止・車両登録/移動・対象ON/OFF・運転日報/CSV/月別提出・申請/承認・プロフィール・経理を確認する。全体管理者本人の編集を維持し、別の有効な復旧担当管理者も確保する。正式な社員・車両はテスト後も保持する。

## バックアップの具体的な確認

- Dashboardで契約プラン、直近の成功日時、保持期間、PITR有効状態と復元可能な時刻範囲を記録する。未確認のまま「自動バックアップがある」と扱わない。許容損失時間（RPO）と復旧時間（RTO）を担当者が決める。
- 移行直前の復元点を確保し、publicだけでなくAuth、登録台帳、車両、日報・申請、制約・trigger・RPC・owner・ACL・RLS・採番を保全対象にする。バックアップ取得・復元は今回行わない。独立した環境への復元試験でデータと権限を確認する。
- Edgeソースとバージョン、JWT設定、Auth設定、公開schema、配信リビジョン・関連JSを別に保存する。secretは安全な保管先で復元可能か確認し、監査結果やGitに書かない。Storage本体（領収書等）はDBバックアップと別に保全する。
- 障害時は新規登録を停止して社員・車両・Auth・台帳を保持し、操作IDで照合する。タイムアウト後の再作成/再解放・無条件DELETE・直接PATCH再許可・旧Edge単独巻戻しをしない。共有DBの時点復元は他業務の更新も戻すため、先に別環境へ復元して差分と復旧範囲を評価する。

参考: [Supabase backups](https://supabase.com/docs/guides/platform/backups)、[別プロジェクトへの復元範囲](https://supabase.com/docs/guides/platform/clone-project)。実際のプラン・設定は別途確認が必要。

## 実Auth検証（本番共有DBでは実施しない）

本番相当の隔離プロジェクトと実際のGoTrueを使用する。メール送信・webhook・cron・外部通知を隔離し、単なるdevelop画面を隔離環境と取り違えない。

| 検証 | 合格条件 |
| --- | --- |
| Auth作成後・紐付け前 | ランダム秘密パスワード、email未確認、ban、operation metadataを確認。意図した初期パスワードでログインできず、セッションが発行されない |
| 別ログイン経路 | 有効なOTP/magic link/回復等でも隔離を抜けない。既発行JWTを持つ旧Authはbanだけで解決済みとしない。API到達性・session/refresh失効を確認 |
| 認可 | 匿名・一般・部署管理者・無効管理者の登録/復旧を拒否。全体管理者でもAuth紐付け重複・登録途中なら拒否。各段階で権限失効も確認 |
| 正常解放 | 社員業務情報確定後、一度だけ初期パスワード設定・email確認・ban解除。DBの完了確認後に成功返却。本人ログイン成功 |
| 通信断 | Auth作成・bind・release・completeの前後で応答を失わせ、二重Auth/社員ができず、同じIDで照合。release結果不明時に再解放しない |
| 再送・競合 | 同一/別操作ID・別タブ・別管理者・独立DB接続で同時実行。worker tokenで古い処理を拒否。入力変更・他人の操作の誤引継ぎを拒否 |
| 失敗と復旧 | 400/422・429・5xx・タイムアウトを区別。DBでも隔離確認できる明確な拒否だけ限定再試行。不明例は担当者照合へ止め、再作成・削除しない |
| 登録途中の編集 | 通常編集・使用停止・車両変更・削除・既存Edge経由を含め保護。完了後は既存の安全な編集を利用可能 |
| 秘密情報 | 初期/復旧パスワード・JWTをlocalStorage、登録台帳、ログへ保存しない。本人がapp_metadataの隔離情報を変更できない |

解放認可のDB commitと外部Auth要求は原子的ではない。認可後の権限失効を完全に同期させる保証はなく、許容条件・監査・手動復旧担当を公開前に確認する。

## ローカル検証

`tests/employee-migration-preflight.test.mjs` はPGliteのメモリ内fixtureのみを使用する。本番URL・資格情報を受け取らず、監査をREAD ONLYトランザクションで実行する。

- SELECT 1文の形と禁止命令・危険な関数呼び出しがないことを静的確認。
- 任意オブジェクト未導入、全移行SQL導入後、匿名の列SELECT、継承権限、カスタムtrigger/definer/view、Auth重複/欠損、RLSで件数が欠ける読者を検証。
- 実行前後の社員/Auth行、テーブル・関数ACL、RLS/policy、trigger、ロール、採番値が不変であることを確認。
- 社員データのsentinelとAuth UUIDが結果に出ないことを確認。本番PostgreSQLやSQL Editorそのものを実行した試験ではない。
