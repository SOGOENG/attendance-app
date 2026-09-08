# 個人工具の本人登録

## 適用

1. 検証用DBで `personal_tool_registration.sql` を実行する。
2. `personal_tool_registration_verify.sql` を実行する。既存の有効な一般社員・工具管理者のAuth連携が必要。工具の変更は最後にロールバックされる（IDシーケンスは進む場合がある）。
3. 検証後、本番DBにも登録用SQLを適用してから画面ファイルを公開する。

この作業環境ではDB接続・ブラウザを利用できなかったため、SQLは未適用、実DB・実画面のテストは未実施。

## 構成と既存仕様

- `tool-registration.js`：工具一覧取得・カタログ取得・本人登録の共通API。
- `personal-tool-registration.js`：登録フォーム。成功後に個人工具画面へ一覧再取得を依頼。
- `personal-tools.html` / `personal-tools.js`：`mine=1` の本人画面にフォームを表示。社員選択を固定し、登録後は検索文字を解除して一覧を更新。
- `tool-master.html` / `tool-master.js`：自動採番登録のみ共通DB採番を使う。画面に出る番号はプレビューで、確定番号を完了表示する。手入力登録・既存工具編集のREST経路は維持。
- `service-worker.js`：キャッシュ世代更新。

既存コードに独立した所有者・使用者列はなく、個人工具は `assigned_employee_id` を参照している。本人登録ではこの列をAuthに紐づく有効な社員IDに設定する。`personal` / `available` / `active=true` / `checkout_managed=true`、現場・協力業者名はnull。

工具種別専用のマスタテーブル定義はリポジトリにないため、既存 `tools` の大分類・工具名だけを利用。点検設定は既存工具から推定しない。充電工具は既存管理者画面と同じく点検対象外。未登録でも既存接頭辞設定を持つ6種の充電工具は選択できる。それ以外は登録済み工具名が候補になる。

本人登録は充電工具なら `inspection_required=false` / `inspection_category=null`。それ以外は `inspection_required=true` とし、本人が `3p` / `double_insulated` / `cord_reel` / `ac_welder` / `dc_welder` から必須選択する。`battery` は選択不可。同名工具に複数の既存カテゴリがあっても登録できる。採番用接頭辞がない工具も管理者による初回登録が必要。旋盤のみ既存ルールのサイズ（1IN～4IN）を選択する。

## DB・権限

- 本人登録RPCは所有者・使用者・番号・点検対象フラグを引数として受け取らない。追加引数 `p_inspection_category text default null` は充電工具以外で5種類のみ許可し、NULL・空文字・不正値を拒否する。充電工具では渡された値を無視してNULLを保存する。
- 有効な社員と `auth.uid()` を照合し、本人IDをサーバーで設定。
- 一般ユーザーの直接INSERTは、既存の許可ポリシーに関わらず追加のrestrictive RLSで拒否。既存のUPDATE/DELETEポリシーは変更していない。
- 管理者RPCは `all` / `tool_admin` を照合。既存管理者の手入力INSERTには既存の許可ポリシーも引き続き必要。
- 採番内部関数はクライアントから実行不可。本人・管理者RPC間をトランザクション単位のadvisory lockで直列化し、全工具の同一接頭辞の最大番号+1（最小3桁）を確定。
- 管理番号の重複防止には、既存UNIQUE制約（インデックス `tools_management_code_key`）とadvisory lockを利用する。一意インデックスは追加しない。既存データを自動修正・削除しない。
- 手入力登録や旧画面との競合は既存の `tools_management_code_key` で拒否する。番号の重複は保存されない。
- この変更に関係する既存DBトリガー・RLSの全定義はリポジトリにないため、実DBでの適用検証が必要。

## テスト

ローカル：`node tests/personal-tool-registration.test.mjs`

実施済み：大分類連動、点検対象外の案内、旋盤サイズ、点検区分5種類の選択送信・未選択の登録抑止、二重送信抑止、本人IDを含まない送信内容、成功・失敗時の表示、一覧更新失敗と登録失敗の区別、管理者の自動採番・手入力・編集の分岐、変更JSの構文。

DB検証SQL（未実行）：充電工具のカテゴリ強制NULL、5種類の選択値保存、NULL・空文字・battery・未知値の拒否、同名工具の複数カテゴリ共存、本人の初期値、採番重複防止、分類改ざん拒否、直接INSERT拒否、一般社員による管理者RPC拒否、管理者の共有工具登録。

公開前の実機確認：

1. 一般社員でマイページ→個人工具を開き、登録ボタンと大分類連動を確認。
2. 充電工具・点検対象工具を登録し、所有者・状態・点検設定・番号をDBで照合。一覧に即反映されることを確認。
3. 所有者ID追加・分類変更などの改ざん、未認証・無効社員で登録不可を確認。
4. 2つのログインセッションから同種工具を同時登録して番号が異なることを確認。
5. 管理者から共有・個人・協力業者工具の自動採番／手入力登録と編集を確認。
6. スマホ幅で入力欄・ボタン・エラーメッセージと更新後の一覧を確認。

## 今回のSQL変更と適用前確認

- `personal_tool_catalog()` の戻り値は大分類・工具名の2列のみ。点検設定の集計と `configuration_error` は削除。
- `register_personal_tool()` は10引数に変更。GRANT / REVOKEも10引数版に更新。
- 旧5引数・6引数RPCを削除してオーバーロードの曖昧さを防ぐ。カタログは戻り型変更のためDROP後に再作成する。CASCADEは使用せず、未知の依存関係があれば停止する。
- 管理者RPC・tool-masterの点検区分処理、共通採番、INSERT RLSは変更していない。既存の `tools_management_code_key` をそのまま利用する。
- 未適用環境では更新済みSQL全文を使用する。既に旧SQLを適用した検証環境では、同名関数の依存関係を確認してから更新する。旧画面では充電工具以外の必須引数を送信しないため、画面も同時に更新する。
- 本番前に実DBのCHECK/ENUMが5種類を許可すること、充電工具でカテゴリNULLを許可すること、既存トリガーが選択カテゴリを書き換えないことを確認する。
- 非充電工具の既存の点検対象外設定は今回の本人新規登録では継承しない。すべて点検対象として登録する。既存行はUPDATE/DELETEしない。
- ロールバック時の本人RPCシグネチャは `register_personal_tool(text,text,text,text,text,text,text,text,text,text)` に変更される。
- ロールバックSQLは `personal_tool_registration_rollback.sql`。対象関数・Policyが今回新規作成された場合に使用する。既存の同名オブジェクトを上書きした場合は適用前の定義へ復元する。一意インデックスのDROPは行わず、既存の `tools_management_code_key` を維持する。

## メーカー・型式・製造番号・性能の追加

- 本人フォームは大分類→工具名→規格→メーカー→型式→製造番号→性能→点検区分→備考の順。旋盤サイズは従来どおり工具名の後に条件表示。
- 追加引数は `p_manufacturer` / `p_model_number` / `p_serial_number` / `p_performance`。すべて `text default null`。既存6引数の後に追加し、省略も可能。
- 保存先は既存の `manufacturer` / `model_number` / `serial_number` / `performance`。RPCで `nullif(trim(...), '')` を適用し、空欄はNULLにする。
- 本機能が未導入なら `personal_tool_registration.sql` 全文を使用。導入済みなら `add_personal_tool_registration_details.sql` のみ追加適用する。追加SQLは本人RPCの置換と実行権限・スキーマキャッシュ通知のみで、カタログ・管理者RPC・RLS・採番・既存UNIQUE制約には触れない。まだSupabaseには適用していない。
- 旧関数削除はCASCADEなし。既存の依存関係がある場合は停止する。SQL適用後に画面を更新する。
- JSテストで4項目の送信・前後空白除去・空欄NULL、既存カテゴリ選択、管理者分岐、初回／追加SQLのRPC一致を確認。検証SQLには実DBの保存値・省略／空文字NULL確認を追加したが未実行。
