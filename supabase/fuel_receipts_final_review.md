# 給油領収書：本番適用前の最終確認

2026-10-17。調査・修正・ローカルテストのみ。本番には接続していない。

## 修正した問題

1. EdgeのアーカイブAPIは出力ID必須とし、不正・欠落時に通常の下書き添付削除へ進まないようにした。
2. SQLの削除完了操作に、削除開始済み状態・削除種別の一致を要求。年次整理では出力IDも固定し、別のZIPや通常削除へ切り替えられないようにした。
3. 年次削除中はバックアップ確認・承認・出力失敗による状態の変更を拒否し、Storage処理中に削除条件が変わることを防いだ。
4. 親日報と添付のロック順序をそろえた。認可拒否は403とし、失敗監査の例外で元のエラーを隠さないようにした。

## 依頼項目との照合

|確認項目|実装と確認結果|
|---|---|
|提出済み添付の変更・削除禁止|SQLで本人かつ下書きを再確認。添付処理中の提出はトリガーで拒否。既存の実提出RPCによる提出成功後、変更・削除拒否を実PGで確認。|
|Storage成功後だけDB完了|Edgeは開始RPC→Storage remove→完了RPCの順。Storageエラー時に完了RPCへ進まない。|
|削除再試行|削除中状態を保持。Storage成功後にDB完了が失敗したケースも、ファイル不在から再試行できることを模擬テストで確認。完了済みは冪等。|
|給油削除との整合性|未完了添付が残る給油の直接削除をトリガーで拒否。添付削除完了後は給油削除可能で、領収書メタデータ・監査を保持。実PGで確認。|
|ZIP保存確認前の年次削除禁止|生成完了と利用者の保存確認を分離。保存確認・会社バックアップ照合・保存義務確認・管理者承認・保存後1年をSQLで再検証。通常の本人下書き添付削除は別の操作として維持。|
|Edge直接呼出しの認可|getUserでJWT確認し、利用者をサーバーで確定。サービス専用RPCでも社員・経理・全体管理者を操作ごとに確認。一般社員からRPC直接実行・権限昇格は拒否。|
|既存Storageポリシーなし|非公開バケットを作成。専用バケットのブラウザ直接操作を制限し、Edgeのservice_roleでファイル操作。許可ポリシーが0件でも社員・anon拒否、service_role許可を実PGで確認。標準Storage ACLとservice_roleのBYPASSRLSは事前照会で確認する。|

Storageのservice keyによるRLSバイパスは[Supabase公式仕様](https://supabase.com/docs/guides/storage/security/access-control)に基づく。DBメタデータだけを削除する設計にはしていない。

## 今回実行したテスト

- 隔離PostgreSQL17.6へ修正SQLを新規適用。`fuel-receipts-db`、`archive-db`、`final-review`、`no-storage-policy`、`rls` のSQLテスト成功。実authenticatedロール／service_roleで確認。本番データは未使用。
- Nodeの `fuel-receipts-server.test.mjs` 成功。認証拒否、削除失敗、DB完了失敗後の再試行、ZIP/CSV/照合、ストリーム失敗等。
- `fuel-receipts-sdk.test.mjs` 成功。実Supabase JS SDK 2.49.8にHTTPを模擬し、利用者JWTを検証した後もRPC/Storage操作がサービス資格情報を使うことを確認。
- Chromeの `fuel-receipts-ui`、`fuel-receipts-admin-ui`、`driving-report-refuels-ui`、`driving-report-submission-ui` 成功。PC/390px/320px、保存・再読込・提出・編集禁止・給油と添付の対応を確認。REST/Edge/Storageは模擬。

## 適用前に残る確認

実Supabase Storage HTTP・Edge/Deno・実iPhoneの撮影と判読性は未確認。ローカルPGのStorage表はフィクスチャであり、クラウド実環境の証明ではない。ステージングでJWT設定、service_role、Storage ACL、署名URL、Storage削除成功後のDB障害と再試行、大容量ZIPを確認する。

今回のSQLは、以前表示した案から削除状態管理の列・検証を追加している。まだ未適用の新規migrationとしてレビューする。以前の案をステージングに適用済みなら、そのまま再実行せず差分適用手順を準備する。

適用順序と通常運用は [fuel_receipts_rollout.md](fuel_receipts_rollout.md)、読取専用の事前照会は [fuel_receipts_preflight.sql](fuel_receipts_preflight.sql) を参照。本番適用・コミット・pushは未実施。

## 追加確認：給油保存と削除ガード

`driving-report.js` の `saveRefuels` は既存行をID指定PATCH、新規だけPOSTし、変更のない行は書き込まない。全件DELETE→INSERTは行わない。画面で削除した行のみ `FuelReceipts.removeForRefuel` 完了後にDELETEする。したがってBEFORE DELETEの `fuel_receipt_refuel_guard` は通常の再保存・給油量/メーター変更には発火せず、添付を残した直接削除だけを拒否する。実装修正は不要だった。

- `fuel-receipts-ui.test.mjs` に、添付済み複数給油を連続保存して給油の書込みが0件であること、両方の給油量・メーター編集がPATCHだけであること、給油ID・領収書ID・紐付けが不変であること、再読込後の値と2件の添付復元の検証を追加。ローカルChrome、PC/390px/320pxで成功（APIは模擬）。DELETEの模擬処理にも添付存在時のガードを追加。
- `fuel-receipts-refuel-update.test.sql` を追加。隔離PostgreSQLの実authenticated権限で、active添付のある給油を2回更新でき、ID・添付状態・紐付けを保持することと、直接DELETEは実トリガーが拒否することを確認。テストデータ変更は全件ROLLBACK。
- 今回はアプリ実装・migration・既存提出RPCの変更なし。本番接続・SQL適用・コミット・pushなし。
