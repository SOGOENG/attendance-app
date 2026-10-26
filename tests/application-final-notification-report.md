# 最終確認の状態表示・通知 追加改修報告

## 作業範囲とGit

`main` の既存未コミット変更を保持して追加実装しました。restore/reset/checkout/stashは使用していません。
開始時は、PDF・申請管理・最終確認UI・SQL・テスト・画像など前回までの変更が未コミットでした。
本番SQL実行・Edgeのデプロイ・実Push配信・commit・pushは行っていません。

## 1. 今回の変更・追加ファイル

- `applications-admin.js`: 最終確認済みラベルに既存のapprovedクラスを使用。
- `applications-final.js`: 同じ緑表示、全申請から待ち有無を判定、通知リンクの待ちタブ指定。
- `applications-final.html`: 件数取得前は待ちボタンにピンクを付けない。
- `applications-final.css`: 待ち0件は選択中でも白系。選択状態は内枠とaria-pressedで区別。
- `applications-admin.html`, `service-worker.js`: 読み込みバージョン・キャッシュ更新。
- `supabase/functions/send-staff-push-notifications/index.ts`: 承認結果に加えて最終確認者へ通知。
- `supabase/add_application_final_confirmation_notifications.sql`: 既存環境用の通知種別・イベント制約拡張。
- `supabase/notification_deliveries.sql`, `supabase/add_application_notifications.sql`: 初期構築・既存差分の通知定義も同じ種別に対応。
- `tests/application-final-notification-edge.test.mjs`, `tests/application-final-notification-db.test.mjs`: 新規テスト。
- `tests/application-final-approval-ui.test.mjs`: 件数別配色、緑表示、リンクの追加検証。
- 本報告書。画像は `tmp/final-approval/` に保存。

## 2–4. 色と選択状態

管理者承認済み・最終確認済みは既存の `.status.approved` の緑を共有します。
最終確認待ちラベルは既存のピンクを維持。新しい色は追加していません。

待ちボタンは、新フロー対象かつ未確認の承認済み申請が1件以上ある場合だけピンク。
確認済みタブを表示していても待ちが残っていればピンクです。
0件なら選択中でも白系に戻し、内枠・aria-pressedで選択を表現します。
確認済みタブの既存デザインは維持しています。

## 5–8. 通知タイミング・対象・内容・遷移先

管理者承認後、既存の `notifyApplication(id,'approved')` が呼ぶEdge Function内で通知要求を追加します。
管理者承認RPC、残数・allocation・出勤簿・本人通知の既存処理は変更していません。
認証済みの有効な管理者からの承認イベントで、DBから取得した申請が次を満たす場合だけ対象です。

- `status='approved'`
- `final_approval_required=true`
- `final_confirmed_at IS NULL`

宛先はEdgeのサービスロールで取得したDB社員の `active=true` かつ
`is_application_final_approver=true`。氏名・クライアントの宛先リストは使用しません。
通常管理者・無効社員・旧フローには最終確認通知を出しません。

タイトル: 「最終確認があります」

本文: 「管理者承認済みの申請があります。最終確認をお願いします。」

遷移先: `./applications-final.html?panel=waiting`

タブ切替時にURLのpanelも更新するため、確認済みタブを開いている既存ウィンドウでも、
通知リンクへの遷移で確認待ちを表示できます。既存Service Workerの遷移処理を利用します。

## 9. 重複防止

既存 `notification_deliveries.idempotency_key` のUNIQUE制約を再利用します。
最終確認通知のキーは `application_final_confirmation_pending:申請ID:社員ID:購読ID`。
配信前にINSERTで予約し、同時呼び出しでも一意制約違反23505なら再配信しません。
複数端末の購読には、既存方式どおり端末ごとに配信します。
同一申請・同一社員・同一端末の最終確認通知は再承認でも再作成しない方式です。
旧フローや過去の確認待ちを走査して一括通知する処理はありません。

## 10. 最終確認後・既読の扱い

最終確認後の再取得で待ち一覧から消え、確認済み一覧へ移り、ラベルは緑になります。
DB取得時点で確認済みの申請について新しい最終確認通知は生成しません。

既存基盤に通知ごとのDB既読フラグはありません。notification_deliveriesは配信履歴です。
通知をタップするとService Workerが通知を閉じ、端末のバッジ処理を行い、指定URLへ遷移します。
ホーム表示時の端末ローカル通知バッジのクリアも維持しています。
確認済みになった時点で既配信通知を削除・自動既読化する変更はしていません。

## 11. 既存通知と運用

申請者本人への承認結果を既存どおり作成した後、最終確認通知を追加します。
提出・差戻し・却下・予定等の通知内容や既存バッジ処理は変更していません。
Push通知が有効な購読端末へ送る方式を継承し、未購読社員向けのアプリ内受信箱は追加していません。
配信失敗の記録・期限切れ購読の無効化・重複スキップも既存方式です。
通知の失敗で既に完了した管理者承認を取り消すことはありません。

反映時は、既存通知SQL・最終確認SQLに続いて新しい通知migrationを適用し、
更新したEdge Functionをデプロイしてからフロントを反映してください。
今回はそのSQL実行・デプロイは行っていません。
新migrationはチェック制約だけを拡張し、既存RLS・クライアント権限・一意制約・過去データを維持します。

## 12–14. 表示・検証結果

320px・1280pxで待ちあり・0件・確認済み・既存履歴カードをテストし、画像も確認しました。
横はみ出しなし。ピンクと緑、白系と選択内枠、ボタン文字を確認しました。
OSへの実Push送信は行わず、実EdgeハンドラーをモックSupabase/Web Pushで実行して
宛先・本文・遷移URL・本人通知維持・重複防止を検証しています。

以下の15テストスクリプトが成功しました。

| 分類 | テスト |
| --- | --- |
| 新規通知 | application-final-notification-edge / application-final-notification-db |
| 状態表示・タブ・権限・印刷制御 | application-final-approval-ui / application-final-approval-db |
| PDF責任者・旧フロー・未確認拒否 | application-print-responsible-ui |
| 有給・代休残数と出勤簿連携 | application-attendance-overwrite |
| 日別割当 | comp-leave-date-allocations-db / comp-usage-allocation-history |
| 直接登録編集削除 | admin-paid-usage-edit-db / admin-comp-usage-edit-db / admin-paid-usage-edit-ui / admin-comp-usage-edit-ui |
| 既存申請・未確認バッジ | applications-comp-ui / application-result-badge-ui / application-result-reads-db |

通知DBテストは旧配信履歴保持、繰り返しmigration、一意制約による重複拒否、
authenticatedからの読み書き拒否を隔離PGliteで検証しました。
既存最終確認RPC・権限・PDF制御・PDF責任者の実装は今回変更していません。

## 15–16. Git確認

`git diff --check` は指摘なし。ブランチは `main`。
開始時の未コミット変更に、通知関連SQL・Edge・新規通知テストと本報告書が加わっています。
既存の未追跡画像・ファイルも保持しています。
本番SQL実行・Edgeデプロイ・実通知送信・commit・pushは行っていません。
