# 社員39・2026年9月分 下書きCSV検証

## 範囲と現状

developでの開発専用機能。対象は社員ID39が実際に保存した2026-08-21、08-24、08-25、08-26、08-27の下書き5日だけ。締め期間は2026-08-21〜09-20だが、残り26日を生成しない。氏名は実際の社員マスタを参照する。SQL作成・隔離ローカル試験までで、本番SQL適用・本番データ変更・実保存データの取得・月別提出・Excel転記/マクロ作成は行っていない。

## 構成

- `../driving-report-csv.js`：正式と検証用で列配列・引用/BOM/CRLF・数値/ID/日時・日報/明細投影・ZIPを共有。公開入口は正式のbuildと固定範囲専用のbuildDraftTestを分ける。buildにモード引数を足して提出条件を緩和する仕組みはない。
- `../dev/driving-report-draft-test.html`、`driving-report-draft-dev.js`：開発画面。通常管理メニュー・ナビゲーション・Service Workerの登録は変更しない。
- `add_driving_report_draft_test_export.sql`：独立した引数なし読取RPC `admin_driving_report_draft_test_source()` の準備SQL。既存の正式RPCは変更しない。

## 正式CSVとの違い

| 項目 | 正式 | 下書き検証 |
|---|---|---|
| 列数・列順 | 日報138・給油26・前回給油17 | 同じ配列・変換処理 |
| export_kind | official | TEST_DRAFT |
| CSV/ZIP名 | 正式・対象月・出力ID | TEST_DRAFT・社員39・2026-09・出力ID |
| schema_version | driving_daily_v1等 | 同じスキーマ、用途はexport_kindで識別 |
| 日報行数 | 月別提出社員×全日 | 保存済み指定5行だけ |
| report_status | submitted | draftを実際の値のまま出す |
| 月別提出ID/日時/ルール版 | 実際の確定値 | 空欄。架空の提出記録は生成しない |
| 未入力項目 | 正式検証で必須不足なら停止 | 空欄/partial/absentを保持し、画面に未完了を表示 |
| 勤務・休日・休暇判定 | 月別snapshotの根拠 | 未実施。該当列は空欄、requirement_reason=TEST_DRAFT_NOT_VALIDATED |
| 給油 | 保存済み給油1回1行 | 同じ。0件ならヘッダーだけ |
| 前回給油 | 正式履歴と不確定性を照合 | 今回の専用RPCでは検索しない。実績車両ごとunverified、日付・量・メーター・根拠IDは空欄 |

前回給油の空欄は「給油履歴なし」ではなく「未確認」。給油量0や車両番号からの推測、他車両のメーター補完はしない。3CSVは同一出力ID・対象月・生成時刻の組でZIP化する。給油0件等のヘッダーのみCSVは、同じIDと対象月をファイル名で対応付ける。

正式入口は検証用source_versionを拒否し、検証入口もofficialや対象外社員/日付/提出済みを拒否する。ただしExcel側のマクロは今回の範囲外。正式Excelの取込では **export_kind='official'の厳密一致**を必須にし、TEST_DRAFTを拒否する必要がある。検証時はExcel原本のコピーと検証専用取込先を使い、印刷・正式提出・正式保存へ流さない。セル番地は原本確認前に確定しない。

## 認証・権限・公開制限

開発画面はhostnameがlocalhost/127.0.0.1/[::1]、http(s)、URLにenableDraftCsv=1がある場合だけ動作する。公開ホスト、192.168系LAN、file URL、明示指定なしは認証スクリプトや通信より先に停止する。API接続先は既存会社用プロジェクトfgmvmbjnoyagnpygcbky、またはループバックのローカルAPIのみ。任意の外部URLを受け取らない。

同じlocalhostオリジンに保存された有効な通常ログインセッションを使い、既存is_application_adminの認証確認を行う。期限切れなら管理者ログインのやり直しを案内する。ブラウザへservice_role・DBパスワード・他人のJWTを埋め込まない。

DB側もAuth UIDと既存is_application_admin()を毎回確認する。本人39でも一般社員ならこの管理者用読取RPCは実行できない。固定日付/社員IDを引数で広げることはできない。指定5日のいずれかが未保存・日別提出済みなら停止し、月別提出記録が既にあっても停止する。

関数はSTABLE/SECURITY DEFINER、空search_path、row_security=off。レビュー済み所有者の読取で完全取得できなければエラーとし、行を隠して5件と誤認しない。既存RLS/テーブルGRANTは変更しない。新規RPCのEXECUTEだけauthenticatedに付与し、PUBLIC/anon/service_roleからは剥奪する。認証/提出/領収書の業務RPCは呼ばず、静的SELECTのみで業務データを変更しない。

localhost制限は公開画面の誤操作防止であり、DB認可の代替ではない。仮に新RPCを会社用プロジェクトへ適用すれば、認可済み全体管理者はAPIを直接呼べる。そこまでの読取面を追加してよいかを、SQL適用前に別途判断する必要がある。この作業では適用しない。

## 実際のポータル保存データを使う次の操作

1. 会社用KazuAttendanceで、対象5日のstatus=draft、社員ID39の対応、既存認可ヘルパー/必要列、関数所有者の完全読取権限を読み取り確認する。5日入力済みという情報はユーザー提示であり、今回本番では照合していない。
2. 新規読取面を追加するSQLをレビューし、別途明示承認された作業で専用SQLを適用する。ここが本番適用の停止点。正式RPCや月別提出RPCは変更・実行しない。
3. リポジトリのルートをループバックにだけ配信する。例：`python -m http.server 8000 --bind 127.0.0.1`。
4. `http://127.0.0.1:8000/login.html` で全体管理者として通常ログインする。既存の本番公開ポータルのセッションはオリジンが異なるため、localhostへJWTをコピーしない。今回ログイン操作は実行していない。
5. `http://127.0.0.1:8000/dev/driving-report-draft-test.html?enableDraftCsv=1` を開き、TEST DRAFT ZIPを取得する。ボタンは専用読取RPCだけを呼び、提出しない。
6. ZIPを検証用フォルダーへ展開し、Excel原本のコピーへ取り込む。日報5行、給油件数、TEST_DRAFT、月別提出欄空欄、前回給油unverifiedを確認する。正式取込が拒否することも確認する。

本番へSQLを追加しない限り、今回の実装だけでは会社用DBの下書きを取得できない。RPC未適用時は説明を表示して停止し、既存正式RPCの条件削除やRESTの管理者認可迂回へフォールバックしない。

## ローカル検証

- `node tests/driving-report-draft-test.mjs`：5行限定、同じ列、TEST_DRAFT、空欄保持、給油0/複数回、前回未確認、正式拒否、対象外拒否、公開ホスト/LAN/opt-in制限、ZIP。
- `python tests/driving-report-draft-ui.test.py`：localhostの模擬RPCとChromeで、成功/opt-inなし/管理者否認/セッションなし/RPC否認/未適用/月別提出済み/5日未充足を検証。PythonのZIP展開とCSVパーサーでも内容を確認する。
- `node tests/driving-report-csv.test.mjs`：共通化後も正式20群を再確認。
- `node tests/driving-report-csv-db.test.mjs`：新規隔離PGlite（公式0.5.10）で正式RPCの既存15群＋検証RPC4群。通常管理者だけが保存5件を読めること、READ ONLYで実行可能、正式RPC定義不変、下書き/月別条件変化時の拒否を確認。PGLITE_MODULEで公式パッケージのdist/index.jsを指定する。本番の全DDL/実データの複製ではない。

実保存データの実検証およびExcel取込の実操作は未実施。本番SQL未適用の停止点を守り、ローカルfixtureのみで検証する。

検証結果：下書きの純粋生成11群＋ZIP、Chrome開発画面8ケース、正式生成20群、正式画面9ケース、隔離PostgreSQLの既存15群＋下書き4群が成功。正式RPC SQLと正式管理画面HTML/JSは作業開始時のSHA-256と一致した。テスト用PGliteパッケージは検証後にtmpから削除し、既存のstash・未コミット変更は保持する。
