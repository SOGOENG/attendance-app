# 申請結果の未確認バッジ

## 適用

`supabase/application_management.sql` 適用済みDBへ `supabase/add_application_result_reads.sql` を適用してからフロントエンドを公開します。SQLは再実行可能です。既存申請も、現在の最新結果に確認済み記録がなければ未確認として表示します。

## 動作

- マイページの「各種申請」カードに未確認件数を表示し、0件では非表示。カードは履歴タブへ遷移します。
- 現在の状態が承認・差戻し・却下で、最新の実際の状態変更に確認済み記録がない本人の有給・代休申請を数えます。submittedや同一状態の監査更新は含めません。
- `application_result_reads` に本人社員ID＋状態履歴ID＋確認日時を保存します。
- 履歴データの読み込み完了後、履歴タブが表示中かつページが前面のとき、表示対象の結果IDだけを確認済みにします。ホーム・マイページ・新規申請タブを表示しただけでは確認済みにしません。
- 古い履歴IDの確認要求が遅れて到着しても、その後の承認結果は確認済みになりません。通信失敗時は未確認を保持し、再表示時に再試行します。
- バッジはマイページ表示・前面復帰時に取得します。Push配信履歴には依存しません。
- RLSで確認済み記録のSELECTを本人のみに制限。書き込みは本人を検証するRPCのみ。他社員IDを指定するRPCはなく、管理者も本人情報のみ取得できます。
- PWAアイコンの端末内Push件数、管理者の承認待ち件数、Push送信条件は変更しません。

## 検証

- `PGLITE_MODULE=/path/to/pglite/dist/index.js node tests/application-result-reads-db.test.mjs`
- `PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node tests/application-result-badge-ui.test.mjs`
- 既存 `tests/notification-badge.test.mjs` と `tests/applications-comp-ui.test.mjs` も実行。

DBテストは隔離PostgreSQL、UIテストはモックAPIを使用します。本番Supabase・実機iPhoneでの確認は含みません。
