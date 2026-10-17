# 給油領収書管理：適用・運用・検証

2026-10-17。ローカル実装と隔離テストのみ。本番DB/Storage/Edge Functionは未変更。
既存の未コミットの運転日報・給油実装を前提とする。

最終照合による修正点・追加テスト・本番前の残確認は [fuel_receipts_final_review.md](fuel_receipts_final_review.md) を参照。

## 判断と権限

- 領収書は提出必須にしない。既存運用を維持し、給油あり・未添付なら提出確認で案内する。
- 経理の専用権限は既存コードに見つからなかったため、`fuel_receipt_roles`を新設。
- 既存の有効社員かつ `admin_scope='all'` は常に全機能を利用可能。氏名による特例なし。
- 一般社員は自分の下書きだけ添付追加/変更/削除。他人の参照は拒否。
- 経理は全員の一覧/画像/原本受領/訂正/出力/バックアップ確認。
- 削除承認と実行・経理権限の付与/解除は全体管理者のみ。
- 領収書と給油はrefuel_id、給油と社員・車両・日付は既存日報で関連付ける。
  給油日の検索は refueled_at を Asia/Tokyo の日付へ変換。車両変更時はその日報の車両に従う。
- 原本受領の取消→再受領で訂正でき、旧状態/新状態/担当者/時刻を監査へ記録する。

## SQL・公開順序（未実施）

1. 担当者が `fuel_receipts_preflight.sql` の読取専用照会で実環境を確認する。
   リポジトリには既存Storage定義がなく、本番バケット/既存ポリシーの現状は未確認。
   employees.auth_user_id/active/admin_scope、認証関数、既存RLS、関数所有者を実DBと照合する。
2. 既存の運転日報テーブル、destination、submission、pre-drive-alcohol各migrationが適用済みか確認。
   `add_previous_vehicle_end_odometer.sql`は既存メーター引き継ぎ用で、今回の領収書SQLとは別。
3. ステージングでDB ownerとして `add_fuel_receipts.sql` 全体を適用。
   CREATE競合時は停止する。既存オブジェクトをIF NOT EXISTSで黙って再利用しない。
4. `supabase/functions/fuel-receipts/` をEdge Functionとして配置。
   SDKは2.49.8を指定。SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEYはサーバー環境変数だけ。
   JWTはプラットフォームの検証に加え `auth.getUser(token)` で確認。ブラウザ由来の社員IDは信用しない。
5. 社員・経理・全体管理者の実アカウントでステージング確認。管理画面で経理権限を付与。
6. 変更内容・権限・既存機能への影響をレビュー/承認してから、本番もSQL→Edge→画面の順で公開する。
   画面ファイルのみ先に公開しない。今回の作業では本番適用・コミット・pushを行っていない。

既存提出RPC本体と既存の13点検/アルコール検証/RLSは変更しない。
追加triggerでpending/deleting添付がある間の提出と、添付が残った給油の直接削除を拒否する。
このため保存と添付の競合で提出済みファイルを一般社員が削除することを防ぐ。
給油削除は社員の下書きで添付をStorage APIから削除→完了記録→給油削除の順。
既存日報・給油への一括更新/削除はSQLに含めない。

## Storage・容量

- 専用非公開バケット `fuel-receipts`、JPEG/PNG/PDF、1ファイル8MiB。
- 元画像は20MiBまで。ブラウザで全体を描画し、幅2400px/最大1600万画素、JPEG品質0.92〜0.86。
  約200KiBを目標にするが無理に切り詰めない。縦長をクロップしない。
  PNGが小さい場合はメタデータを引き継がないcanvas PNGを採用。
- 元画像6000万画素超は拒否。文字が判読できるかはユーザーが拡大して確認する。
- HEIC/HEIFはブラウザの画像デコードが使える場合に変換。非対応環境ではJPEGへの変換/
  iPhoneの互換性優先を案内。任意HEICを全ブラウザで変換する外部ライブラリは導入していない。
- PDFは再圧縮しない。サーバー側でマジックバイト・サイズ・SHA-256を検証する。
- ストレージ全体の予約済み量（pending/deleting含む）800MiBで新規予約を拒否。
  他バケットの使用量は含まないため、本番の残容量確認後にこの上限を運用判断する。
- 実ファイルは不透明なUUID/SHAパス。公開URLなし。閲覧は権限確認後の60秒署名URL。
- Storageの既存の広い許可ポリシーがあっても、専用バケットをanon/authenticatedから直接
  参照/更新できないrestrictive policyを追加する。他バケットの許可条件は変更しない。
  実ファイル操作はサービスロールを持つEdge経由だけ。鍵は画面へ送らない。
- メタデータのSELECTにもRLS。書込はサービス専用RPCのみで、同RPCでも本人/権限/下書きを再確認。
- アップロードIDをブラウザで固定し、同じID/内容の再試行は重複作成しない。
  上書きuploadはしない。Storage削除失敗時はdeletingで残し、再試行で復旧する。
- pending操作が残った場合は本人が該当下書きの「添付を削除」で整理できる。自動削除はしない。
  ファイル予約・閲覧・差替/削除・失敗・原本訂正・権限変更・出力・バックアップ・承認・整理を監査。

## ZIP・会社側バックアップ

対象は給油日の月（JST）。検索絞り込みにかかわらず月全件を出力する。
`YYYY-MM/給油領収書一覧.csv`、`YYYY-MM/manifest.json`、
`YYYY-MM/社員名_社員ID/給油日_領収書_UUID.ext`。
CSVはUTF-8 BOM/CRLF、引用符とExcel数式のエスケープを行う。
ZIPはサーバーで1ファイルずつ読み出すSTORE方式（圧縮済み画像/PDFを再圧縮しない）。
manifestに出力時点のID/ファイル名/バイト数/SHA-256を固定。
ファイル読み出し時もハッシュを照合し、失敗/キャンセルは失敗履歴として残す。

ブラウザがFile System Access対応なら選択したファイルへ逐次保存。
非対応（iPhone等）はBlob方式で64MiBまで、それ以上は対応PCの利用を案内し中断する。
Edgeの実稼働時間/転送制限はステージングで確認する。大きい月は対応PCでも再試行が必要な場合がある。

サーバーの生成完了は generated、利用者が保存を確認して初めて downloaded。
どちらも会社管理先へのバックアップ確認にはしない。

会社側でZIPを保存・展開後、次を会社管理フォルダに対して実行する（ネットワーク通信なし）。

```sh
python3 scripts/verify-fuel-receipt-backup.py /会社管理先/2026-10/manifest.json --output /会社管理先/backup-verification.json
```

ファイル件数/サイズ/SHA-256が一致した照合結果JSONを管理画面へ指定し、会社管理の保存先と
保存義務・社内ルール確認を記録する。これは権限者の確認記録であり、サーバーが会社の
ファイルサーバーの存在や将来の保管継続を自動で保証するものではない。
電子帳簿保存法等の適用・保存期間・会社管理先の要件は経理/社内責任者が確認する。
この実装で法令適合を自動判定したとは扱わない。

全体管理者の承認後、ファイル自身のsaved_atから1年以上の現存バージョンだけ手動整理。
削除候補はDB側で抽出し、実行時にも全条件を再確認。
25件ずつ削除し、成功/失敗を分けて記録。完了するまでarchivedにはしない。
失敗時は同じZIPから再試行でき、完了済みは次の候補から除外。
Storage画像だけを削除し、日報・給油・領収書メタデータ・監査は残す。

## 実施したテストと未確認

- Node: `tests/fuel-receipts-server.test.mjs`。Auth、社員ID偽装、形式/サイズ、冪等性、
  削除失敗、署名TTL、実ZIP展開/CSV、照合スクリプト、ストリーム失敗。
- ローカルChrome＋模擬REST/Edge/Storage：`tests/fuel-receipts-ui.test.mjs`、
  `tests/fuel-receipts-admin-ui.test.mjs`。PC/390px/320px、撮影input、縦長画像圧縮、
  PDF、HEICエラー案内、複数添付、差替/削除、車両変更、再読込、原本訂正、ZIP、バックアップ/承認/整理。
- 既存 `driving-report-ui` / `driving-report-submission-ui` / `driving-report-refuels-ui` 回帰。
- 隔離したPostgreSQL17.6：新migration適用、本人/経理/管理者、実authenticatedロールのRLS、
  サービスRPC直呼び不可、直接Storage参照/書込拒否、監査変更不可、800MiB上限、バックアップ/承認/年齢条件。
- 既存の実submit_driving_reportを社員ロールで呼び、pending時の拒否・完了後の提出成功・
  提出済み添付変更拒否を確認。Storage表はPGフィクスチャで、Storage HTTP自体は模擬。

未確認：実iPhoneの撮影/HEIC/回転/文字判読性、Safariの挙動、本番SupabaseのStorage/署名URL/
Edge実環境、実会社保存先のバックアップ、実規模での転送時間。
Deno/Supabaseクラウド上のEdge実起動は未実施。Nodeで同じhandlerをテストした。
これらは本番適用前にステージングと実機で確認する。

ローカルDB再現は空の隔離DBで tests/fuel-receipts-setup.sql をownerとして実行し、
fuel-receipts-db.test.sql をservice_role、quota.test.sqlをowner、
ownerでreceipt1のsaved_atを2年前にした後archive-db.test.sqlをservice_role、
storage.objectsに専用バケットの架空行をownerで挿入後rls.test.sqlをauthenticatedとして実行。
submit-guard.test.sqlは13点検/両アルコール/両経路/メーター入力済みの日報1とpending添付を用意して実行する。
本番・共有DBにはテストsetupを実行しない。

参考：[Supabase private buckets](https://supabase.com/docs/guides/storage/buckets/fundamentals)、
[Auth getUser](https://supabase.com/docs/reference/javascript/auth-getuser)。

## 今回のファイル

追加：
- `fuel-receipts.js`
- `fuel-receipts-admin.html` / `.js` / `.css`
- `supabase/add_fuel_receipts.sql`
- `supabase/fuel_receipts_preflight.sql`
- `supabase/fuel_receipts_rollout.md`（本書）
- `supabase/functions/fuel-receipts/index.ts` / `handler.mjs` / `archive.mjs`
- `scripts/verify-fuel-receipt-backup.py`
- `tests/fuel-receipts-server.test.mjs`
- `tests/fuel-receipts-ui.test.mjs` / `fuel-receipts-admin-ui.test.mjs`
- `tests/fuel-receipts-setup.sql` / `fuel-receipts-db.test.sql` / `fuel-receipts-archive-db.test.sql`
- `tests/fuel-receipts-rls.test.sql` / `fuel-receipts-quota.test.sql` / `fuel-receipts-submit-guard.test.sql`

変更：
- `driving-report.html` / `.js` / `.css`（既存の給油欄と保存処理への接続）
- `admin.html` / `side-menu.js`（管理画面への入口）
- `tests/driving-report-ui.test.mjs` / `driving-report-submission-ui.test.mjs` / `driving-report-refuels-ui.test.mjs`
  （領収書APIモック追加と既存機能の回帰テスト）

既存のメーター引き継ぎSQL・そのテストなど、以前の作業の未コミットファイルは今回の領収書機能とは別。

追加確認：100MiB超・600ファイルのZIPを全体バッファに保持せず生成・消費するテスト、
ダウンロードキャンセルの失敗履歴を確認。実回線の大容量転送を負荷試験したものではない。

## 標準カメラ優先の撮影方法（追加条件）

- 撮影は `input type=file accept=image/* capture=environment` によりOSへ委ねる。
  getUserMedia等の独自カメラ制御・連続映像・ピント操作は実装しない。
- 「標準カメラで撮影」と、capture指定のない「写真・ファイルから選択」を分離。
  添付後は「標準カメラで再撮影」「写真・ファイルを差し替え」に切り替わる。
  撮影/選択のキャンセルでは現在の添付を消さない。下書きだけ変更可能。
- 画像は領収書全体を保持し、約200KiBに収めるための過度な圧縮はしない。
  日付・金額・明細を拡大して確認する案内を表示する。
- OSのファイル入力を開く方式であり、実際の撮影メニューは端末・ブラウザに依存する。
  iPhone実機の標準カメラ起動、ピント合わせ、再撮影、縦長領収書の判読性は本番公開前に別途確認する。
- 既存の工具QR読み取りコードは変更しない。
