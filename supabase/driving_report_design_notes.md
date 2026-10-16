# 運転日報 DB設計案（レビュー用・未適用）

## 今回の範囲と前提

`driving_report_schema.sql` は設計検討用です。本番Supabaseには接続・適用していません。画面、通知、未入力管理、CSV生成、Excel取込、service-workerは変更しません。SQL末尾は誤適用防止の `ROLLBACK`。既存同名テーブルを黙って再利用せず、`CREATE TABLE` の競合時は停止します。実導入時は事前調査・仕様確定後に別の適用用migrationを作成してください。

**基本1日1人1車両。複数車両対応は将来拡張**。1主現場を基本とし、`unique(employee_id, report_date)` を維持します。朝は `draft` 保存、帰着後に完成させて `submitted` へ変更します。新規作成は必ずdraftで、直接submittedとしてINSERTすることは拒否します。日付をまたぐ勤務は開始日の `report_date` に所属させ、各イベントは実際の日時を保存する案です。

## 既存構造の調査と再利用

リポジトリ内のSQL・JS等を検索した範囲では、`vehicles`、車両番号、ナンバーを持つ車両マスタ相当の定義は見つかりませんでした。ただし本番DBの実在を否定するものではありません。今回の `vehicles` は**実DBにも存在しないと確認できた場合の案**です。

再利用するもの：

| 既存要素 | 用途・確認元 |
|---|---|
| `employees(id,name,department,active,auth_user_id,admin_scope)` | 本人、所属、確認者、監査担当。全列の実DB型は適用前に確認 |
| `sites(id,display_name)` | 現場FK。`site_master.sql` / 既存画面の参照を確認 |
| Supabase Auth | 既存のAuth紐付けをそのまま使用 |
| `current_employee_id()` | `auth.uid()` に紐づく有効社員ID（`application_management.sql`） |
| `is_application_admin()` | 有効社員かつ `admin_scope='all'`（同ファイルおよび `add_application_notifications.sql`） |

これらの既存関数・テーブル・RLSは置換しません。工具管理者・部署管理者・残数管理者に全社員の運転日報権限を自動付与しません。

鈴木 和弘さんの常時利用は、既存社員レコードが `active=true`、本人Authに正しく紐付き、全体閲覧が必要なら `admin_scope='all'` であることを前提に実現します。今回は本人レコードの実データは未確認です。氏名一致による認証迂回や特例権限は追加しません。無効アカウントでも利用可能にする意味の「常時」は既存権限と矛盾するため採用しません。他社員の編集まで必要な場合も、現要件の管理者全件参照とは分けて確認が必要です。

適用前の読取調査候補（今回未実行）：

```sql
select table_schema,table_name,column_name,data_type
from information_schema.columns
where table_schema='public'
  and (table_name ilike '%vehicle%' or table_name ilike '%driving%'
    or column_name in ('vehicle_number','registration_number','vehicle_id'))
order by table_name,ordinal_position;
-- 車両台帳が別名称の場合、pg_descriptionのコメントや運用中の台帳も確認。
select id,name,department,active,admin_scope,auth_user_id is not null as linked_to_auth
from public.employees where replace(replace(name,' ',''),'　','')='鈴木和弘';
```

## テーブル構成

| テーブル | 粒度・主な内容 | 制約 |
|---|---|---|
| `vehicles` | 社内車両番号、車名、登録番号、使用可否、備考、作成更新日時 | 社内車両番号unique。登録番号の表記統一・重複ルールは未確定なのでunique未設定 |
| `driving_reports` | 社員・日付・運転有無・車両・主現場・経路・メーター・事故違反・備考・提出監査 | `unique(employee_id,report_date)`。未来日不可、本人・対象日・IDは保存後変更不可 |
| `driving_report_inspections` | 日報×点検コード、結果、備考、実施日時 | 複合PK `(driving_report_id,inspection_item_code)` |
| `driving_alcohol_checks` | 日報×出発前/帰着後、測定値、確認方法、確認者、日時 | `unique(driving_report_id,check_type)` |
| `driving_refuels` | 日報に0〜複数の給油、日時・給油所・支払方法・L・メーター・備考 | 親FKと時刻順index |

全てbigint ID（点検は複合PK）。`timestamptz` は実時刻、`date` は業務日。距離はkm、給油はLを想定。メーター0.1km、給油0.001L、測定値0.001刻みを仮採用し、実車・測定器・Excel様式で確定します。測定値の単位・機器仕様も未確認です。この案は法令上の検査・保存要件を保証するものではなく、ここでは業務データ構造のみを扱います。

### 運転なし・データ整合性

- `driving_status='no_driving'` もdraftからsubmittedへ提出します。提出時は車両・現場・経路・メーターはNULL、事故違反はfalse。備考は入力可能。距離はNULL（0km走行と区別）。draft・提出済み・行がない日を区別できます。
- `driven` は提出時に車両、経路区分、開始/終了メーター必須。draftではこれらのNULLを許可します。終了≧開始。距離は生成列で算出し、入力改ざんを避けます。
- `office`=会社経由、`direct`=直行、`direct_return`=直行直帰、`other`=その他を仮定。直帰のみ等を含む正確な区分は紙様式で要確認。`route_note` は経路の自由記載。
- 現場未指定は許可（会社内・現場外移動など）。自由入力の現場名は現案では扱わず経路備考を利用。複数現場・複数車両の1日内利用は運用確認事項で、必要なら走行区間テーブルを別途設計します。
- 運転なしの日に点検・測定・給油を追加することは禁止。運転あり→なしに直す場合は先に明細を削除。親行ロックで同時明細追加との競合を抑止します。
- 社員・車両・現場のFKは原則RESTRICT。履歴のため物理削除せずactive/visibleで運用。子は親削除時CASCADEですが、認証ユーザーに日報のDELETE権限は付けません。
- 社員名・所属・車両番号・現場名をサーバーでsnapshot化。マスタ変更で過去出力を変えません。車両/現場を訂正した場合はsnapshotも更新します。確認者が社員ならその氏名を保存し、社外確認者はIDなしで氏名必須。
- 事故違反ありは提出時に説明必須。保存する点検不良明細には説明必須。数値の負値、NaN、Infinityは範囲制約で拒否します。

## 13項目の点検：固定列と明細型の比較

| 案 | 利点 | 欠点 |
|---|---|---|
| 13固定列 | 一覧/CSVが単純、必須チェックが容易 | 項目追加・名称変更・項目別備考/時刻の追加にschema変更が必要 |
| コード＋結果の明細 | 項目ごとの備考/時刻、履歴、追加項目に対応しやすい | 出力時pivotと提出時の必要項目集合チェックが必要 |

**明細型を採用**。結果は `ok / defect / not_applicable`。追加マスタは作らず、確定した13項目の安定コードをDBの `driving_required_inspection_codes()` に定義し、将来のアプリ定数では同じコードと表示順を使用します。提出可否はアプリやRPCだけに依存せずDB triggerで検証します。「全項目良好」は13行を同一トランザクションでupsertし、個別不良を修正できる構成です。

**現在は紙の13項目の正確な名称・コードが未提供**なので架空の13項目は作りません。SQL案には13コードの完全一致検証を組み込み、`driving_required_inspection_codes()` の定義リストは空にしています。正式な13コードを設定するまで運転ありの提出は `inspection_definition_not_configured` で拒否します。任意の13行で提出を通すことはできません。draft保存と運転なしの提出は可能です。既存の不良を「全項目良好」で意図せず上書きしないUIも後工程です。

## 初回提出・遅延入力

| 方法 | 評価 |
|---|---|
| 生成列 | 保存済み提出日時からの計算には使えるが、提出日時自体の偽装や更新を防げない。現在時刻ベースだと初回提出の意味にならない |
| trigger | 初回時刻をDBで固定し、訂正時も保持できる。既存システムの監査trigger形式と合わせられる |
| アプリ保存 | 実装は簡単だが端末時刻・API直接操作・タイムゾーン差に弱い |

**trigger採用**。INSERTでは `created_at` のみDB時刻で確定し、`submitted_at`、`late_entry`、`late_entry_days` はNULL（未提出・未判定）。初めてdraft→submittedへ変わり検証に成功したときだけ `statement_timestamp()` で提出日時を確定します。クライアントが送った提出日時は使いません。

`late_entry_days = greatest((submitted_at AT TIME ZONE 'Asia/Tokyo')::date - report_date, 0)`、`late_entry = late_entry_days > 0`。

例：10/16朝にdraft作成し、同日夕方に提出→0日、10/17に提出→1日。10/20に訂正しても初回提出が10/16なら遅延0日のままです。未来日は拒否。作成者は本人、更新者もサーバー確定。日付誤りの修正専用運用は将来検討（初回日時をリセットする安易な削除再登録は不可）。

朝は日付・本人・運転有無でdraftを作成し、車両・出発情報・点検・出発前測定を順次保存できます。帰着後に終了メーター・帰着測定・給油・事故違反・備考を追加し、最後にstatusをsubmittedへ更新します。draftでは必要明細が欠けていても保存可能です。明細行を作る場合はその行の型・値・NOT NULL制約は維持するため、未実施の測定は空行を作らず未登録とします。提出時は親triggerが必須本体情報・正式13点検コード・before/after各1件を検証します。給油は0件でも可。運転なしは運転用情報・明細不要です。

訂正はsubmitted→draftに戻してから行い、再提出時に同じ必須検証を行います。初回submitted_atと遅延情報はdraftへ戻しても保持します。submittedのまま本体訂正や明細INSERT/UPDATE/DELETEは拒否し、提出後の必須情報の欠落を防ぎます。親行ロックで明細保存と提出を直列化します。将来の一括保存RPCは親を先にロックし、draftの明細更新→最後にsubmitted更新を同一トランザクションで行う構成です。

### 提出時必須チェック（運転あり）

| 対象 | draft → submitted 時の検証 |
|---|---|
| 車両・メーター | 車両、開始メーター、終了メーターが入力済み。既存案の経路区分も必須 |
| 始業点検 | 正式な13コードの定義と明細のコード集合が完全一致。未確定の定義では提出不可 |
| アルコール | `before`（出発前）と `after`（帰着後）が各1件存在。測定値・日時・確認方法・確認者氏名は明細の制約で保証 |
| その他 | 事故違反ありの場合は説明必須。給油は0〜複数件で必須ではない |

draftは未入力の親項目や未登録の明細を許可しますが、入力済みの値の範囲・参照先・明細行の必須列は検証します。必須不足による提出失敗時はUPDATE全体が取り消され、draftと未確定の初回submitted_atを維持します。再提出失敗時も保存済みの初回submitted_atは変わりません。

## RLS・権限案

| 対象 | 本人 | 全体管理者 |
|---|---|---|
| 車両 | SELECT（履歴表示のため非activeも参照可能） | SELECT/INSERT/UPDATE。物理DELETE不可 |
| 日報 | 自分のみSELECT/INSERT/UPDATE、DELETE不可 | 全件SELECT、更新は自分のみ |
| 明細3種 | 自分の日報のみSELECT/INSERT/UPDATE/DELETE | 全件SELECT、変更は自分のみ |

`authenticated` に必要な操作のみgrant、`anon`/`PUBLIC`をrevoke。子のRLSは親をEXISTS参照します。UPDATEはUSINGとWITH CHECKの両方を設定。本人・日付・明細の親IDのすり替えはtriggerでも拒否します。

新規SECURITY DEFINER triggerは空のsearch_path、完全修飾名、本人検証を使用。直接EXECUTEはrevoke。既存管理者関数は変更しません。管理者代理編集、訂正履歴テーブル、締め後ロック、変更前後の監査ログは今回未実装です。service_roleを使う将来の出力APIはRLSを迂回し得るため、原則本人のJWTで実行し、任意社員IDを信用しません。

## 21日〜翌20日・CSV取得案

SQL末尾に**コメントとしてSELECT案**を記載。公開viewや出力機能は作成しません。開始日（21日）と社員IDをパラメータ化し、`report_date >= 開始日 AND report_date < 開始日 + interval '1 month'`。例：2026/12/21〜2027/01/20、2028/02/21〜03/20も同じ条件です。未来の入力境界では開始日が21日であることを検証します。

CSV対象はstatus=submittedのみ（訂正中draftも除外）。本体を起点に社員・車両・現場をJOIN、朝/帰着測定をそれぞれ1:1 JOIN。点検と給油は個別LATERAL集約してからJOINし、13点検×複数給油による行増殖・二重加算を避けます。通常は1日1行を維持し、給油の複数回はJSON配列＋合計Lで保持。Excelが給油回数固定列か別行かは未確定なのでCSV列への展開は後工程です。

社員日付unique indexが社員単位期間検索、日付社員indexが全員一覧、親FK先頭のPK/unique/indexが明細JOINを支えます。`employees`等の既存RLSで現在名が見えなくてもLEFT JOINで日報自体を落とさず、snapshotを出力に使えます。将来view化するならsecurity_invokerと既存マスタRLSを検証し、owner権限で他社員情報を漏らさない設計にします。

## 適用前に確定・検証する事項

- 実DBの車両台帳の有無と既存列型、鈴木さんの有効なAuth/管理者設定。
- 紙の13点検コード、測定単位・確認方法の選択肢、経路区分、車両番号の意味/表記。
- 将来の複数車両/現場対応、運転なしでも給油のみを記録するケースの要否。
- 全項目の一括保存・不完全提出拒否・訂正履歴・日付訂正の運用。
- RLSの一般社員/全体管理者/部署管理者/無効社員/匿名、同日重複、親付替え、未来日/数値範囲、JST日付境界、訂正後の遅延保持、同時保存の試験。
- 締め期間の月末/年末/うるう年、複数給油の非重複集計、Excel列対応、マスタ変更後のsnapshot維持。

以上が未確定のため、このSQLをそのまま本番入力機能として公開しないでください。

## 初版のローカル検証（初回保存＝提出だった時点）

隔離したPGlite（PostgreSQL）で、既存社員/現場/認証関数を最小fixtureとして作成して検証しました。本番接続はありません。

- SQL全体の構文、末尾ROLLBACKで新規テーブルが残らないこと。
- 隔離DB内のみでCOMMITに置き換え、点検・朝/帰着測定・複数給油の保存、snapshot、距離算出を確認。
- 2日前の日報が遅延2日になり、提出日時/遅延値を送信して訂正しても初回値が保持されること。
- 同日重複、本人ID変更、終了メーター逆転、運転なしへの明細追加を拒否すること。
- 本人のみ参照、管理者の全件参照・他社員編集不可、匿名アクセス拒否。

実DBの既存RLSとの組合せ、複数接続の同時実行、実Auth、紙様式・Excel列の適合性は未検証です。

## 下書き対応後のローカル検証

隔離PGliteでSQL全体を実行し、DB時刻のみテスト用関数へ差し替えて確認しました。本番Supabaseには接続していません。

- 未完成draftを保存でき、submitted_at・遅延情報はNULL。
- 同日提出は遅延0日、日本時間の翌日提出は1日。
- 訂正のためdraftへ戻して再提出しても初回提出日時・遅延情報は不変。送信値による日時上書きも不可。
- submittedとしての新規作成、必須本体項目不足、点検コード未確定、点検不足、朝/帰着測定不足を拒否。
- 隔離DB内だけでテスト専用13コードを定義して、完成時の提出成功を確認。SQL案に架空コードは記載していません。
- submittedの明細削除を拒否。draftへ戻して点検を削除すると再提出時に不足を検出。

基本1日1人1車両のunique制約、RLS、snapshot、点検明細・アルコール・複数給油の構造は維持しています。CSV取得案は提出済みのみを対象に変更しました。

### 中断後の再確認（2026-10-16）

上記のローカルDB検証記録は中断前から残っていた内容です。今回の再開作業ではDB実行テストは再実施していません。既存案を確認し、点検定義がNULLの場合の提出拒否、出発前・帰着後それぞれの測定の存在確認を明示し、提出時必須チェックの説明を追記しました。`git diff --check` と、未追跡の2ファイルを対象とした `git diff --no-index --check` による空白検査でエラーがないことを確認しました。本番適用・コミット・pushは行っていません。
