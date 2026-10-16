# 現場選択と自由入力の行先

本番未適用。新規migration：`add_driving_report_destination.sql`。

既存のsite_idとsite_name_snapshotは現場マスタの参照・履歴用です。snapshotは既存triggerがDB側で設定するため、自由入力には流用せず `driving_reports.destination_text text NULL` を追加します。既存日報はNULLのまま保持し、UPDATEやバックフィルは行いません。

- 現場選択：site_idを保存、destination_textはNULL。
- その他（自由入力）：site_idはNULL、destination_textに入力値を保存。画面だけの選択値 `__other__` はDBへ送信しません。
- 選択なし：両方NULL。自由入力選択時は1〜500文字を入力し、空のままなら「選択なし」へ戻してください。
- 本日運転なし：画面は行先を隠し、朝の保存時にsite_idとdestination_textをNULLにします。draftの不完全状態は許可しますが、行先が残るno_drivingの提出はDB制約で原子的に拒否します。
- 下書きの再読込／提出済みの表示：destination_textがある場合はその他を選択し、値を表示。提出済みは既存どおり編集不可です。

CHECK制約でマスタ現場と自由入力の同時指定、空文字・500文字超、運転なし提出時の行先を拒否します。新規RPCやマスタ登録機能、通知・CSV・Excelは追加しません。既存の社員基準保存、行き経路、帰り経路、snapshot・提出日時・RLS・権限は変更しません。

適用は前提の運転日報テーブル・既存migrationの適用状況を確認後、所有者として新SQL全体を一度実行し、その後driving-report.html/jsを反映してください。今回は実行していません。SQL末尾でPostgREST schema cacheを更新します。

検証：employee-managed-vehicle-db.test.mjsの23グループがPGliteと一時PostgreSQL 18.4で通過。追加4グループでは旧日報不変、現場／自由入力の切替、制約、自由行先のあるdriven提出と編集制限、no_driving提出失敗時のdraft維持を確認。driving-report-ui.test.mjsで保存・再読込・入力不足・提出済み表示・現場マスタへのPOSTがないことを確認しました。実Supabase Auth・本番固有triggerとの結合は未検証です。
