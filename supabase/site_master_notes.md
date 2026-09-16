# 元請・現場マスタ改善

## 実装前調査と変更範囲

`sites / site_id / display_order / input_code / client_code / client_name / construction_no` をリポジトリ全体で検索した。
変更前HEADの全一致行は [site_master_reference_inventory.txt](site_master_reference_inventory.txt) に保存。
申請日付の `display_order` など、現場とは無関係な一致も省略せず収録している。

| 参照ファイル | 処理・対応 |
|---|---|
| `site-admin.js`, `site-admin.html` | 新規・編集・検索・表示切替。元請選択、採番RPC、グループ表示、↑↓、必須エラーへ変更 |
| `app.js` | 出勤簿の現場一覧・検索・雑工事現場照合・保存・復元。一般現場の取得順を変更、ID・コード検索・保存は保持 |
| `attendance-admin.js` | 出勤簿管理、現場名、工事番号、CSV。IDによる参照のみで順序依存なし。変更不要 |
| `applications.js`, `applications-admin.js` | 申請／休日出勤登録の選択肢のみ取得順を変更。履歴用ID検索、承認、代休計算は維持 |
| `application-print.js` | 申請の現場IDから印刷名を取得。変更不要 |
| `shared-tools.js`, `tool-checkout.js`, `tool-move.js` | 現場一覧・貸出／移動先の取得順を変更。current/from/to_site_id と履歴処理は維持 |
| `tool-inspection-list.js` | 現場絞り込み一覧の取得順を変更 |
| `near-miss.js` | 現場選択の取得順を変更、名称ソートを除去。記録のsite_id/client_nameは維持 |
| `near-miss-admin.js` | 保存済み名称表示・CSV。変更不要 |
| `personal-tools.js`, `tool-detail.js`, `tool-master.js` | ID→現場名の対応表、工具の現在地／履歴表示。変更不要 |
| `shared-tool-state.js` | current_site_idの有無による状態判定。変更不要 |
| `supabase/application_management.sql`, `add_application_attendance_sync.sql`, `fix_application_attendance_sync_found.sql`, `add_comp_leave_expiration.sql`, `comp_leave_availability_functions.sql`, `fix_comp_leave_reservations.sql` | sitesへのFK、出勤簿反映、休日出勤・代休。既存FK・値を維持、変更不要 |
| `supabase/add_return_shared_tool.sql`, `add_personal_tool_registration_details.sql`, `personal_tool_registration.sql`, `add_personal_tool_identity_correction.sql`, `tool_catalog_registration.sql` | 工具登録・訂正・返却・履歴のsite_id。変更不要 |
| 既存テスト・検証SQL | 一致箇所は全件一覧に収録。現場データやFKの互換性を新規DBテストで検証 |

追加：`client-admin.html/js`, `master-admin-common.js`, `master-admin.css`、migration / preflight / verify SQL、DB・ブラウザーテスト。
変更：上表の対象JS、対応HTMLのスクリプト版、`settings-admin.html` の導線、`service-worker.js` のキャッシュ版。

### input_codeの調査結果

- 旧現場登録画面の例は `A001`。`app.js` は文字列として検索、選択肢属性、入力行へコピー。桁固定・分割・数値化処理はない。
- CSVは `attendance-admin.js` が `site_id` から `construction_no` を取り出す。今回その処理は変更しない。
- 本番preflightのユーザー確認結果：一般は `元請コード + 3桁以上の数字`、雑工事は `元請コード + Z + 3桁以上の数字`。`site_type` は「一般」「雑工事」。本番DDLはリポジトリにないため、型の長さ・採番default・既存トリガーは引き続き適用前に確認する。
- 新規だけsite_typeに応じたprefixで別系列採番。一般S005→S006、雑工事SZ002→SZ003。欠番は埋めず、SOZ001・SOZ002がなくてもSOZ004→SOZ005。999→1000以降も切り詰めない。
- 最大値は全既存コードからそのprefix＋数値に完全一致するものを対象に取得する。非表示現場や種別を後日変更した現場のコードも使用済みとして扱い、元請・種別の編集で旧コードは変更しない。候補の全現場重複確認＋unique index＋トランザクションロックを維持。
- 既存 `sites.id` と `input_code` を変えるUPDATEはDBトリガーでも拒否する。

## DB設計

- `clients(id,name,code,visible,display_order)`。初期6社の名称・順序はSQL初期データだけに持つ。順序は三機工業 → STS → 三晃空調 → 朝日工業社 → 西原衛生 → 自社。既存の `client_name='STS', client_code='ST'` はコード・現場の紐付けを引き継ぎ、初回移行で2番目に配置する。それ以外の既存元請は後続に配置。以降はすべて画面から追加・並び替え可能で、SQL再実行時も管理者が変更した順序を上書きしない。
- `sites.client_id` を追加してFK連携。`client_site_order` を追加して元請内の順番を独立管理。
- 旧 `display_order` は**移行・並び替え・通常編集で変更しない**。新規行のみ全体末尾の互換値を設定。
- 本番の旧display_order=1が2件、=7が2件という重複もそのまま保持する。client_site_orderで元請内順を独立管理し、初期の同順位は表示名・IDで安定化する。
- 移行は旧順序→表示名→IDの順で元請内順序を生成。すべての既存項目のJSONを移行前後で比較し、差異があればトランザクションをロールバック。
- `site_master_order` は `security_invoker` ビュー。元テーブルのRLSを維持し、左結合なので元請未設定の旧データも取得。非表示元請でも既存現場は除外しない。
- 保存・並び替えRPCはDB上の有効社員とadmin_scopeを確認。既存設定画面と同じく空/none/tool_adminを除外。新テーブルの直接更新権限は付けない。sitesの既存RLS・権限は変更しない。
- 元請／現場の↑↓は非表示も含む全グループを単一トランザクションで1,2,3…に再設定。画面が持つID配列との比較で古い画面の操作を拒否。
- 名称は会社接尾辞・全半角・空白を正規化した一意性を確認。現場から元請を自由作成できない構造で表記揺れを防ぐ。

## 既存データの扱い

- `三機` は移行時に `三機工業` に対応付け、会社接尾辞差も正規化する。旧client_name/code文字列は変更しない。
- それ以外の略称・異なる名前と同じコード、同じ名前と異なるコードは推測して統合しない。衝突時は**移行全体をロールバック**する。調査結果をもとにSQLの一時対応表 `legacy_clients` にマッピングを追記して再実行する（旧sitesを補正・削除しない）。
- 元請名のない既存行はclient_id=NULLのまま末尾に表示。編集時に適切な元請を選択して紐付ける。
- 既存コードのない元請のみ、未使用のC001等を初期コードとして発行。既存コードがあればそちらを採用。
- 元請名・コードの編集は既存sitesの互換用文字列とinput_codeへ一括反映しない。現場マスタの見出しには最新元請名を表示。現場の所属元請を明示的に変更した場合だけ互換用client_name/codeを更新し、新元請末尾に移す。ID・入力コードは引き続き維持。
- 既存出勤簿の「雑工事」には部署選択を伴う旧業務ルール（短縮名を含む）がある。一般現場選択と異なるため、今回そのルール・保存済みmisc_companyは変更しない。新規の一般現場は追加元請でもコード修正なしで利用可能。

## 適用手順

1. DBバックアップを取得し、`site_master_preflight.sql` を実行。件数・legacy_checksumを保存。実際のsites制約・権限・トリガー・コード体系を確認する。PostgreSQL 15以上が必要。
2. 曖昧な元請対応や既存input_code重複があれば、既存値を変更せず移行方針を確定する。重複を無断修正するSQLは含めていない。
3. 登録操作を停止した配信時間帯に、`site_master.sql` を信頼されたテーブル所有者として実行する。スキーマキャッシュ再読込を含む。再実行でも既存並び順・表示状態を維持。
4. `site_master_verify.sql` を実行。件数・checksumが事前値と一致すること、元請対応・グループ順を確認。
5. その後フロント一式を配信。DB適用前に新フロントを配信しない。PWAのキャッシュ更新後、画面を再読み込み。
6. 管理者で元請追加／↑↓／非表示、現場追加／編集／↑↓を確認。社員で現場選択、既存出勤簿とCSV、工具の現在地・貸出・移動・履歴を確認。

本作業では本番DBへの適用・本番配信は行っていない。旧フロントへ単純に戻すと新規現場のclient_idが渡らないため、登録を止めた状態で対応する。追加テーブル・カラムを削除する自動ダウンSQLは提供しない。

## 検証

- `tests/site-master-db.test.mjs`：隔離したPGlite上で実SQLを実行。旧項目/FK維持、再実行、通常編集、採番・桁上がり、重複／元請対応衝突の全体ロールバック、非表示、独立並び替え、古い一覧拒否、一般社員／工具管理者拒否、viewのRLS継承。
- `tests/site-master-ui.test.mjs`：実ブラウザー＋ローカルHTML＋モックAPI。未入力エラーとフォーカス、非表示元請の候補制御、保存ペイロード、絞り込み中並び替え禁止、競合エラー、390px表示、権限拒否。
- 全ルートJS構文チェック、git diff --check。既存申請・残数・工具の回帰テストも実行。
- 既存の `shared-tool-state.test.mjs` は変更前からある改行入り呼出を単行正規表現で検査して失敗、`tool-catalog.test.mjs` は変更していない旧migrationに存在しないSEED区切りを要求して失敗。今回の機能とは別の既存テスト不整合として記録。
- PGliteは単一接続なので実際の複数接続同時登録・PostgREST経由・本番RLS構成はステージングで確認が必要。unique制約とDBロックの実装は含む。

実行例（各依存は本番アプリに追加不要）：

```sh
PGLITE_MODULE=/path/to/@electric-sql/pglite/dist/index.js node tests/site-master-db.test.mjs
PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs BROWSER_PATH=/path/to/browser node tests/site-master-ui.test.mjs
```
