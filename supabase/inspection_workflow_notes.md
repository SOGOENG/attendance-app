# 半年点検フロー改善

## 画面

- トップ：点検中、履歴、新しい半年点検を開始の順。点検中だけ初期展開。履歴の暦年は現在年が初期値。点検名の年を優先し、旧データで年を特定できない場合は作成日時の年、両方不明なら「年不明（過去データ）」に残す。通常の6月・12月点検を年単位で表示し、旧来の任意名の履歴も消さない。
- 点検サイクル画面：点検進捗（初期展開）、QRコードで点検、管理番号から探す、条件から探す、新しい工具を追加、点検サイクル情報、CSV出力。それ以外は初期閉鎖。検索結果は検索実行時に別の結果領域へ表示する。
- 管理番号は入力前後の空白を除いた完全一致でtoolsを検索。条件検索・QR・カード描画・点検入力ページ・点検チェック項目・CSV形式を再利用する。QRアコーディオンを閉じるとカメラを停止する。
- 権限は既存is_tool_registration_admin()を使用。工具管理トップのカード権限制御は変更していない。新規フローでも同じ判定結果を共有する。

## 未登録工具

1. 所有区分（shared/personal/contractor）、所有者、大分類、有効な工具名、点検区分、備考を入力。マスタの点検設定を初期表示する。今回点検する実機は点検対象として登録する必要があり、マスタが対象外なら利用者に対象への変更を求める。マスタ自体の初期値は変更しない。
2. 工具名があればそのマスタだけを利用し、工具名マスタの行は追加しない。
3. 名前がなければ「マスタにない工具名を登録」を開く。工具名・接頭辞・点検初期値・有効状態・並び順を入力し、確認ダイアログに同意したときだけ既存REST経由でtool_catalogに追加する。既存名・無効名を重複追加しない。
4. register_inspection_toolが既存register_admin_toolを呼び、toolsの実機1台とサイクルへの追加資格を同一トランザクションで作成する。管理番号は既存のマスタ採番、旋盤サイズは既存のSB-サイズ採番をそのまま利用する。
5. 管理番号と「点検入力へ進む」「QRを発行する」を表示。QRは既存tool-qr.htmlを別タブで開き、表示された管理番号で検索する。QR発行ページの処理は変更しない。

登録要求IDと入力内容をsessionStorageに保存する。通信応答が失われても同じID・同じ内容で再試行し、作成済みの工具を返す。SQLエラーでロールバックした場合は入力修正が可能。同じ要求IDを別内容や別利用者で再利用することはDB側で拒否する。別の端末から同じ実物を別要求として二重登録することまでは識別できないため、登録前の検索も必要。

## 完了済みサイクルへの初回点検

履歴から対象サイクルを開き、「新しい工具を追加」で新規購入工具の初回点検であることを確認して登録する。追加可能なのはこの操作で新規作成したtools行のみ。任意の既存tool_idを追加するAPIは設けない。

完了済み画面の対象一覧は、そのサイクルに記録がある工具と明示的に追加した工具に限定する。点検済み工具は結果表示のみ。未登録の既存工具に点検入力リンクを出さない。

保存時にDBが追加資格・対象サイクル・新規購入の確認・未消費・全サイクルで初回であることを検証する。保存成功後は資格を消費し、再利用不可。サイクルのcompleted状態は維持する。既存の完了結果は変更・削除不可（既存CSV出力フラグと更新日時だけ更新可）。新規工具はtools.inspection_required=trueなので、次回の通常点検対象に含まれる。

## 同時点検

検索、QR判定、再表示、タブ復帰、「最新の状態に更新」でDBから再取得し、フィルターを保持して未点検一覧を更新する。点検結果は1000件単位でページング取得する。

保存は従来のtool_inspectionsへのPOSTを継続する。DBトリガーがサイクル行をロックして重複工具・重複シールを検証し、結果INSERTと次回シール番号の更新を一つのトランザクションで行う。画面からの独立したカウンターPATCHを廃止した。別の担当者が同じシール番号を先に保存したらエラーにし、現物のシール番号を確認して再入力してもらう。貼付済みの番号を勝手に変更しない。

既存の重複履歴は削除・統合しない。新しいINSERTから重複を防止する。入力画面でも保存前に点検済みを再確認し、二重クリックを防ぐ。失われた保存応答の再試行は既存結果へのリンクを表示する。

## DB変更が必要な理由と影響

リポジトリの既存コードには、サイクルへの追加資格を記録するテーブルや、その場で新規登録した工具だけを証明する処理がない。toolsの登録日時やブラウザのフラグだけでは、過去工具への自由な追記を安全に制限できないため、次を追加する。

- 新規テーブルtool_inspection_additions：工具ID、サイクルID、要求ID、登録内容、初回購入フラグ、登録者、消費日時。authenticatedは工具管理者のみSELECT可能。直接INSERT/UPDATE/DELETEは付与しない。
- 新規RPC register_inspection_tool：工具新規登録と資格作成のためのラッパー1本。既存register_admin_tool、既存採番、is_tool_registration_adminを再利用する。
- tool_inspectionsに、登録資格・重複を確認するBEFORE INSERT、次回番号・資格消費を更新するAFTER INSERT、完了結果を保護するUPDATE/DELETEトリガー。
- 初回追加資格を持つ工具だけを許可する限定的なINSERTポリシーをtool_inspectionsへ追加。既存ポリシー、GRANT、RLS有効状態は変更しない。既存のrestrictive policyは優先される。

SQL適用時に既存tools、tool_history、点検結果、管理番号を更新・削除しない。通常の点検保存時には従来どおりtool_inspectionsとサイクルの次回番号を更新する。既存の工具登録RPC・採番RPCの定義は変更しない。

## 本番への適用前に必要な確認

実DB接続は利用できず、リポジトリにも元の点検テーブルDDL一式がないため、実DBスキーマとRLSの実証は未実施。特にtools.id / tool_inspection_cycles.idがbigint互換、次回シール番号が整数型であることを確認する。既存トリガーやrestrictive INSERTポリシーが完了済みサイクルへの追加を禁止している場合は、その定義を確認してから調整する。本SQLは既存の制限を勝手に削除しない。

実行順：

1. inspection_workflow_preflight.sql：型・制約・ポリシー・トリガー・既存RPC・重複データを読み取り専用で確認する。
2. 使い捨てDBでtests/inspection-initial-additions.test.sqlを実行する。public.toolsが既にあるDBでは即停止する。既存登録の最小スタブと実際の新規SQLで、再試行、完了済み追加、過去工具の拒否、初回のみ、結果保護、CSV更新、次回サイクルを検証する。実行後はロールバックする。
3. スキーマ・既存制限との互換性を確認後、inspection_initial_additions.sqlを手動適用する。前提はtool_catalog_registration.sql導入済み。今回は適用していない。
4. フロントを配信し、service-workerのstaff-portal-v83へ更新する。SQLより先に新フロントだけを配信しない。未導入時は点検入力の保存を止め、カウンター未更新のまま保存しない。
5. 実ログインの2端末で同じ工具・同じシール番号の同時保存、履歴への新規購入工具追加と通常工具拒否を確認する。旧キャッシュの入力画面は閉じ、再読み込みしてから運用を再開する。

## 変更ファイル

- tool-inspection.html / tool-inspection.js
- tool-inspection-list.html / tool-inspection-list.js
- tool-inspection-entry.html / tool-inspection-entry.js
- tool-inspection-workflow.js（新規）
- tool-inspection-registration.js（新規）
- service-worker.js（v82 → v83）
- supabase/inspection_initial_additions.sql（新規）
- supabase/inspection_workflow_preflight.sql（新規）
- supabase/inspection_workflow_notes.md（本書）
- tests/inspection-workflow.test.mjs（新規）
- tests/inspection-registration.test.mjs（新規）
- tests/inspection-initial-additions.test.sql（新規）
- tests/tool-detail-status.test.mjs（キャッシュ期待値のみ更新）

## テスト結果

成功：新規inspection-workflow / inspection-registration、既存personal-tool-registration / personal-tool-update / shared-tool-return / tool-detail-statusの計6本。構文・HTMLのdetails開閉数、ID重複、差分チェックも確認。

既存の未変更領域に関する失敗2本：tool-catalog.test.mjsは現行SQLにないBEGIN SEED QUERYマーカーを前提にして失敗。shared-tool-state.test.mjsは現行共有工具の返却実装に存在しないSharedToolState.returnSharedTool呼び出しを要求して失敗。今回、対象実装とこの2本のテストは変更していない。

SQLファイルは用意したが、PostgreSQL実行環境がないため未実行。DBでの同時保存、RLS、実ブラウザ・カメラ・CSVファイルの実機確認は未実施。

## 完了済みサイクルへの追加先制限

完了済みへの初回点検追加は、completed を end_date DESC NULLS LAST、start_date DESC NULLS LAST、id DESC で並べた先頭1件だけです。名称の年月、created_at、updated_at は判定に使いません。登録RPCと保存トリガー、追加INSERTポリシー、フロントは latest_completed_tool_inspection_cycle_id() の判定を共用します。active の通常追加は従来どおりです。

登録後に別サイクルが最新になった場合、旧サイクルへの点検保存は拒否します。過去の点検結果は閲覧できます。成功済み登録の同一request_id再送は既存工具を返すだけで、追加登録や点検保存は行いません。

適用済み環境でも supabase/inspection_initial_additions.sql を再実行してください。既存データの書換えはありません。SQL回帰テストは tests/inspection-initial-additions.test.sql（空の使い捨てDB専用）です。
