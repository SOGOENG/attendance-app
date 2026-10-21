# 代休使用履歴の割当表示調査

リポジトリ内のDDL・申請保存・承認処理を調査した結果。本番DBへの接続・SQL実行は行っていない。

追記: 以下は日別保存追加前の構造と過去データのfallbackの説明。新規提出分の日別保存は `add_comp_leave_date_allocations.sql` と `comp_leave_date_allocations_notes.md` を参照。過去データの一括補完は引き続き行わない。

## 現行構造

- `comp_leave_application_details`: 申請IDと備考。
- `comp_leave_dates`: `id`, `application_id`, `leave_date`, `days`, `display_order`。申請内の使用日。
- `comp_leave_allocations`: `id`, `application_id`, `holiday_work_record_id`, `allocated_days`。申請と休日出勤の割当。申請ID・休日出勤IDの組に一意制約。
- `holiday_work_records`: 元の休日出勤日 `work_date`。
- `applications`: `submitted_at`, `approved_at`。同じカードの下部へ一度だけ表示。
- `application_status_history`: 申請の状態変更履歴。使用日単位の割当は保存していない。

`applications.js` の `submitComp` は使用日配列と休日出勤割当配列を独立して保存する。`application_management.sql` の承認処理および `fix_comp_leave_reservations.sql` は申請単位の合計日数と残数を検証する。使用日IDへの参照列はなく、配列順・日付順から実対応を復元できない。

## 表示

- 使用日が1件かつ合計一致: 実allocationごとに使用日と割当元を表示。0.5日ずつ複数割当も分割表示する。
- 割当元が1件かつ合計一致: 全使用日の割当元はその1件に確定するため使用日ごとに表示し、元allocationの合計も明記。
- 両方が複数: 使用日一覧と実allocation一覧を同じ申請カード内にまとめ、「日別の対応は確定できません」と表示。仮のペアは作らない。
- 合計不一致・取得不足: 対応を断定せず、不一致・未取得・元日付不明を表示する。
- `holiday_work_record_id` で休日出勤の日付を取得。表示順は対応判定には使わない。

管理者直接登録は登録RPC・編集RPCが使用日1件とallocation群を保存するため、単一使用日の表示方式を適用可能。ただし今回そのUIは変更していない。

全ての複数日・複数割当申請を日別対応表示するには、今後の申請で使用日IDと休日出勤ID・日数の対応を保存するDB構造と入力・検証処理が必要。過去データの正確な対応は現行データだけでは復元できず、確認なしの自動補完は不可。今回DB変更・残数計算・割当・承認処理の変更は行わない。
