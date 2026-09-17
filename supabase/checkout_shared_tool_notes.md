# 共有工具持出しの原子化

## 原因と確認範囲

QR読取（tool-qr-reader.js / shared-tools.js）→ tool-detail.html → tool-checkout.html → checkoutTool()。
旧処理は tools PATCH（Prefer: return=minimal）→ tool_history POST の2リクエスト。
PATCHのresponse.okだけでは更新0件を検出できず、履歴のみが保存される。
一般社員を拒否するフロント権限チェックや持出しRPCは存在しなかった。

一般社員のUPDATEポリシーがないRLSをローカルPostgreSQLで再現し、UPDATE 0件を確認済み。
本番のポリシー・GRANT・トリガーは未取得のため、具体的な本番原因の確定には
checkout_shared_tool_verify.sql の実行結果が必要。テーブル権限不足などがHTTPエラーになる場合は
旧実装でも履歴追加へ進まないため、今回の症状は更新0件の経路と整合する。

参考: [PostgreSQL RLS](https://www.postgresql.org/docs/17/ddl-rowsecurity.html)、
[PostgREST transactions](https://postgrest.org/en/latest/references/transactions.html)。

## 適用順

1. checkout_shared_tool_verify.sql で現状のポリシー・権限・トリガーを確認する（読取のみ）。
2. 信頼されたテーブル所有者で add_checkout_shared_tool.sql を実行する。
3. tool-checkout.js / tool-checkout.html / service-worker.js を配信する。
4. 開いていた旧持出し画面を閉じ、再読込して tool-checkout.js?v=5 が使われていることを確認する。
5. 一般社員の認証セッションで、貸出可能な検証用共有工具をQRから玉野川（9）へ持出す。
   toolsの現場9・本人社員ID・in_use・更新日時と、checkout履歴の現場9・本人操作IDを確認する。
   管理者の代理持出し、一覧、履歴、返却・移動も実画面で確認する。

RPC未適用・通信失敗時はエラーを表示し、直接PATCH/履歴POSTへのフォールバックはしない。
応答を受け取れなかった場合は成功表示せず再読込で実状態を確認する。
旧ページを開いたままのクライアントは旧処理を実行し得るため、配信時は再読込が必要。

## 変更する仕様・維持する仕様

- 有効な社員であれば管理者権限なしで持出可能。auth.uid()から社員を特定する。
- 一般社員の持出者は本人。リクエストの他人の社員IDは採用しない。
- all / tool_admin の管理者は従来の持出者選択を維持。操作履歴の操作者は認証本人。
- 工具をFOR UPDATEでロックし、持出済み・修理・停止・廃棄・無効・管理対象外を拒否。
- tools更新→履歴追加を1トランザクションにし、例外・更新0件・履歴追加0件で全体を取り消す。
- 既存RLS・テーブルGRANTは広げない。SECURITY DEFINER関数のEXECUTEのみauthenticatedへ付与。
- 非表示現場は拒否。元請が非表示でも現場自体が表示中なら許可。
- 返却・移動・詳細・履歴・一覧の処理は変更しない。非共有工具の旧経路も変更しない。
- service workerをv87、持出しJSをv5へ更新。

既存の履歴65・66や工具295・296は、このSQLでは変更しない。
後続の返却・移動や現物の所在を確認せず、過去の履歴だけから現在のtoolsを上書きしない。

## ローカル検証

tests/shared-tool-checkout-db.test.mjs は独立したPGlite PostgreSQLを使用し、本番接続しない。
一般社員RLS再現、本人への持出し、管理者代理持出し、重複拒否、UPDATE/INSERTの例外と0件時の
全体取り消し、無効社員・工具・現場・匿名の拒否、既存返却RPCとの連携を確認する。
tests/shared-tool-checkout.test.mjs はRPC単独呼出、成功時のみ通知・遷移、エラー・不正応答・二重送信を確認する。
