# 社長最終承認 改修・ローカル検証報告

追記: 追加方針によりUI表記と過去申請の扱いを変更しました。
現在の仕様・検証結果は [追加改修報告](application-final-confirmation-update-report.md) を参照してください。
以下は初回実装時点の記録です。

実装先: `main`。本番SQL実行・commit・pushは実施していません。

## 作業開始時

`git status --short --branch` は `main...origin/main`、未追跡の `tmp/site-search/` のみ。
`git diff` は空でした。依頼に記載された既存改修は作業ツリーに存在しており、
有給直接登録の編集削除SQL、代休日別割当SQL・表示ロジックは変更していません。
restore/reset/checkout/stash は使用していません。

## 変更・追加ファイル

- `supabase/add_application_final_approval.sql`: 列・RPC・保護トリガー・索引・権限。
- `applications-final.html`, `applications-final.js`, `applications-final.css`: 専用ページとレスポンシブ表示。
- `admin.html`, `applications-admin.html`: ページ導線とスタイル読み込み。
- `applications-admin.js`: 管理者承認済み／社長承認状態、印刷操作の表示制御。
- `application-print.js`, `application-print.html`: DB確認とキャッシュ用バージョン更新。帳票レイアウト関数は維持。
- `service-worker.js`: キャッシュ更新と新ページ登録。
- `tests/application-final-approval-db.test.mjs`, `tests/application-final-approval-ui.test.mjs`: 新機能の検証。
- `tests/application-attendance-overwrite.test.mjs`: 新migration適用後の実承認・最終承認・取消の回帰検証を追加。
- 本報告書。画面テスト画像は `tmp/final-approval/`。

## DB・権限・RPC

新規テーブルはありません。

| 列 | 用途 |
| --- | --- |
| `employees.is_application_final_approver` | NOT NULL、既定false。Supabase側で対象2名だけ手動設定 |
| `applications.final_confirmed_at` | NULLなら社長確認待ち |
| `applications.final_confirmed_by_employee_id` | 最終承認者。employeesへの外部キー |

日時と承認者のNULL整合性制約、確認待ち用の部分索引を追加。
氏名判定、権限の自動付与、過去承認の補完はありません。

- `is_application_final_approver()`: 既存管理者権限に加え、有効社員・専用フラグを確認。
- `confirm_application_final(bigint)`: ログイン・権限・approved・未確認を検証し、行ロックして日時と操作者を記録。重複は拒否。
- `assert_application_printable(bigint)`: ログイン・管理者・approved・最終承認済みを検証。
- `set_application_printed(bigint,boolean)`: 行ロックし、印刷済み登録時は最終承認を検証。既存の印刷済み解除は管理者に許可。

SECURITY DEFINER関数のsearch_pathは空に固定。公開・匿名実行をrevokeし、必要なRPCだけauthenticatedへgrant。
既存RLSポリシーは変更していません。Invokerトリガーで、APIロールからの専用フラグ変更・最終承認情報の直接INSERT/UPDATEを拒否します。
権限フラグは社員編集画面へ追加していません。

## 画面と業務処理

通常管理者も専用ページを閲覧できます。最終承認ボタンは専用権限のある管理者のみ。
確認待ち・承認済み・全件の切替、申請内容、管理者と最終承認者・日時を表示し、確認済みには操作ボタンを出しません。
このページにPDF出力はありません。

既存の各種申請管理には、管理者承認済みラベルと社長状態を併記。
管理者承認の残数反映、出勤簿連携、本人通知は従来どおり実行し、最終承認は追加情報だけを更新します。

PDFページは帳票生成前・表示直前・印刷ボタンの処理内で専用RPCを呼びます。
社長確認待ちはボタンだけでなく処理側でも拒否。印刷済み登録もDB/RPCとトリガーで拒否します。
既存の印刷日・印刷者・チェック表示は保持します。

approved以外への遷移で最終承認日時と承認者をトリガーがクリア。
差戻し・取消・承認取消・draft戻しなど、呼び出し元の処理に依存せず対応します。
approvedへ再遷移しても確認待ちから開始します。

## 過去データ・適用手順

過去申請はすべて最終承認NULLのまま。過去印刷済みのチェック・日時・操作者は保持します。
ただし再印刷は最終承認後とします。過去印刷済みを印刷許可の例外にする自動処理は追加していません。
再印刷が必要な過去申請は専用ページから確認できます。

本番適用時は、既存の申請管理・印刷状態SQLが導入済みであることを確認し、
新しいmigrationを適用後、Supabase上で対象2名のフラグを手動設定してからフロントを反映してください。
SQL未適用の環境では新しい列/RPCの読み込みが失敗するため、SQLとフロントの反映順に注意してください。

## 検証結果

本番への接続はせず、PGliteの隔離DBとモックAPIを使ったヘッドレスEdgeで検証しました。
実アカウントでの本番Supabase検証は未実施です。

| テスト | 結果 |
| --- | --- |
| application-final-approval-db | 合格: 一般管理者・一般社員・無効社員・未ログイン拒否、直接改変拒否、未承認／二重承認拒否、印刷制御、過去データ、取消・再提出 |
| application-final-approval-ui | 合格: 権限別ボタン、最終承認、承認済み読み取り専用、エスケープ、専用ページと既存履歴の320/1280px、印刷処理からのDB確認 |
| application-attendance-overwrite | 合格: 有給・代休×既存出勤簿4条件。新migration適用後の承認時残数反映、最終承認時の残数・出勤簿不変、取消時の復元と確認情報クリア |
| admin-paid-usage-edit-db / admin-paid-usage-request-identity-db | 合格 |
| admin-comp-usage-edit-db / comp-leave-date-allocations-db | 合格 |
| application-result-reads-db / comp-leave-expiration-edge | 合格 |
| admin-paid-usage-edit-ui / admin-comp-usage-edit-ui | 合格 |
| comp-usage-allocation-history / applications-comp-ui / application-result-badge-ui | 合格 |

上記14テストスクリプトが成功。変更JSの構文確認も成功。
`git diff --check` は指摘なし。
画面画像を確認し、320pxでラベルやボタンのはみ出しがないことを確認しました。
同時実行の競合は行ロックで直列化していますが、別セッション同時実行テストは未実施です。

## 通知の調査

既存Edge Function `send-staff-push-notifications` に、提出時の管理者通知・承認結果の本人通知基盤があります。
最終確認者向け通知は追加していません。専用フラグで宛先を限定し、通知種別と重複防止を追加する改修が今後の候補です。
既存通知の処理・送信先・呼び出しは変更していません。

## 終了時の状態

ブランチは `main` のまま。上記ファイルは未コミットです。
元から存在した `tmp/site-search/` は保持。
今回のテスト画像 `tmp/final-approval/` と既存バッジ回帰テストの画像 `tmp/application-result-badge-mobile.png` も未追跡です。
本番SQL実行・commit・pushは行っていません。
