# 運転日報CSV出力 調査・設計案

調査日：2026-10-19（日本時間）／作業ブランチ：develop

## 1. 結論と調査範囲

運転日報CSV（日別横持ち）・給油CSV（給油別明細）・前回給油CSV（車両別参照情報）を、同じ対象月・出力ID・取得時点で生成し、ZIPで一括ダウンロードする。正式対象は `driving_report_month_submissions` に当該月の記録がある社員のみ。日別 `driving_reports.status='submitted'` だけでは正式対象にしない。

初回調査では本書だけを追加し、その後の実装依頼で管理画面・CSV生成・ZIP・読取RPCの差分SQLを追加した。本番適用前レビュー依頼に従い、新規の隔離ローカルPostgreSQL（PGlite）でSQLの実行検証を追加した。本番SQL適用、本番変更、ブランチ切替、コミット、push、stash操作は行っていない。調査開始時はdevelopで追跡対象の変更なし、既存stashは1件。リポジトリ内に適用準備SQL・レビュー用SQLが混在しているため、以下は**リポジトリの定義を合成した仕様**であり、本番DBの実在列・適用状況との照合は別途必要。

Excel原本（xls/xlsx/xlsm/xlsb/xlt系）・VBAソース（bas/vba）は検索範囲で見つからなかった。表裏の配置、日付分割、セル番地、印刷範囲、既存取込処理は未確認。帳票に必要な情報がすべて揃うとは現段階では断定できない。

### 確認した主な根拠

| 資料 | 確認事項 |
|---|---|
| `create_driving_report_tables.sql` | 日報・車両・点検・検査・給油の基礎型、制約、RLS、スナップショット |
| `driving_report_schema.sql` | 初期レビュー案。ROLLBACKで終わり、単一route_type等がある。実装仕様の基準にしない |
| `add_driving_report_submission.sql` | 正式13点検、日別提出RPC・検証 |
| `add_driving_report_destination.sql` | 自由入力行先、現場との排他 |
| `add_pre_drive_alcohol_checks.sql`、`../driving-alcohol.js` | 新旧検査、部分入力、電話確認、Excel確認者コード |
| `add_employee_default_vehicle.sql`、`add_vehicle_master_management.sql`、`add_employee_managed_vehicle.sql` | 現在の既定車両と当時の車両名の区別 |
| `add_driving_report_month_submission.sql`、対応notes | 月別提出記録、snapshot、排他、編集禁止、休日・休暇判定 |
| `fix_driving_month_calendar_holiday_attendance.sql` | 会社休日と整合する休み行の免除を追加した後続レビューSQL |
| `add_fuel_receipts.sql`、`../fuel-receipts.js` | 給油に結びつく画像・原本受領・保存状態と権限 |
| `../driving-report.js` / html | 保存単位、入力項目、旧記録保持、給油再保存、表示名 |
| `../driving-report-month.js`、`../driving-report-workday.js`、`../driving-report-month-mode.js`、`../driving-report-period.js` | 月一覧、期間、モード制限と本人向けRPC |
| `../attendance-admin.js` | 既存出勤簿の全員CSVと締め期間 |

## 2. 現行データ構造と取得方針

`driving_reports` は `unique(employee_id, report_date)` により社員1人1日1件、車両も1件。点検は `(driving_report_id, inspection_item_code)`、検査は `(driving_report_id, check_type)` が一意。給油は `driving_refuels.id` ごとに複数件保存する。

以下の略号を全列表で使用する。

- **M**：`public.driving_report_month_submissions`。`id/employee_id/submitted_by` bigint、`closing_month/period_start/period_end` date、`submitted_at` timestamptz、`rule_version` integer、`snapshot` jsonb。
- **D**：`M.snapshot.days[]` の日別オブジェクト。date/calendar/required/reason/report_id/status/issue/attendance/leave_application_id/holiday_work_record_ids。これはSQLの独立列ではなくJSONキー。
- **R**：`public.driving_reports`。日報ID・社員ID・車両ID・現場IDはbigint。日付date、状態・経路・名称・備考はtext。メーターと距離はnumeric(12,1)。事故有無・遅延有無boolean、遅延日数integer、日時timestamptz。追加列 `alcohol_check_version` smallint、`vehicle_name_snapshot` text、`destination_text` text。
- **I**：`public.driving_report_inspections`。親ID bigint、コード/result/note text、checked_at timestamptz。
- **A**：`public.driving_alcohol_checks`。id/親ID/確認者ID bigint、check_type/方法/確認者名/note text、checked_at timestamptz、alcohol_value numeric(6,3)、is_zero boolean生成列、phone_confirmed boolean。
- **F**：`public.driving_refuels`。id/親ID bigint、refueled_at timestamptz、fuel_station/payment_method/note text、liters numeric(9,3)、odometer_km numeric(12,1)。

社員の識別元は `employees.id`（bigint）。追加指定に従い、両CSVとExcelヘッダーの氏名・所属は、出力時点の社員マスタ `employees.name/department`（text）から取得する。日報なし日も同じ社員マスタ値を使用し、社員IDで結合する。これは初版の「日報snapshot優先」案を置き換える方針であり、DBの日報snapshot自体は更新しない。inactive社員も正式対象なら取得する。マスタ参照失敗・必須氏名欠落をsnapshotで黙って補完せず出力エラーとし、所属未設定の帳票上の扱いは確認する。過去月の再出力でも現在の氏名・所属となるため、当時表記の再現が必要なら別仕様を決める。

車両は日別R.vehicle_idと `vehicle_number_snapshot/vehicle_name_snapshot` を使用する。`employees.default_vehicle_id` は今の入力初期値であり過去実績の取得元にしない。`vehicles.id/vehicle_number/vehicle_name/registration_number` は現在マスタ。旧日報の車両名snapshot NULLを現在名で黙って補完しない。registration_numberに当時値の保存はない。inactive社員・車両・非表示現場を、確定済み過去実績から除かない。

## 3. 対象・除外・欠損の扱い

対象月2026-10は2026-09-21以上2026-10-21未満。DB引数は月初date（2026-10-01）。月別提出は日本時間の翌21日以降。画面には会社API向け初月2026-10・開発ホスト制限があり、SQLの存在だけで公開済みとは判断しない。

正式CSVは全体管理者 `is_application_admin()` の認可で、M.closing_monthが指定月の社員だけを対象とする案。部署管理者への拡張は既存RLSが全社員参照を許すと推測しない。未提出社員数と社員ID一覧を出力前に示し、「全員提出完了」と「提出済み分のみ」を区別する。約30人の運転日報対象者名簿は未確定で、出勤簿の `attendance_required` や既定車両の有無をそのまま代用しない。

日報CSVは対象社員×期間内全日を出す。M.snapshot.daysを提出時の判定根拠とし、日報IDでRを対応付ける。`D.status` は提出直前のdraftを含み得るため、提出後状態にはR.statusを使用する。日報不要日も1行残すことで、全期間休暇の社員をExcel側で認識できる。

| 日の状態 | 出力・扱い |
|---|---|
| 必須日の運転あり | day_state=driven。点検・検査・運転情報を出す |
| 明示した運転なし | day_state=no_driving。業務詳細は空欄、距離を0に補完しない |
| 会社休日・祝日、日報不要 | day_state=exempt_company_holiday。日報ID空欄、運転状態空欄 |
| 承認済全日有給・代休、日報不要 | day_state=exempt_full_leave。D.reasonと休暇種別・申請IDを出す |
| 休日でも既存日報あり | 日報を出す。休日という理由だけで除外しない |
| 半日休暇・勤務あり | 判定は月別提出側を継承。勤務日として日報を出す |
| 必須日なのに日報なし | 正式提出なら不整合。正式3ファイルの生成を中止して社員・日付・原因を表示 |
| カレンダー不明・勤務休暇矛盾・snapshot欠落 | 現在データで勝手に再判定せず正式出力を中止 |
| 日別提出のみ／月別未提出 | 正式対象外。確認用を作る場合だけ明示区分して出す |

会社休日は曜日で推定しない。月別RPCはholidays.date/day_type、attendanceのwork_date/status/site_type/leave_type/source_application_id/source_type、承認済applicationsとpaid_leave_application_details、comp_leave_dates（admin_direct台帳を除外）、activeのholiday_work_recordsを照合する。cancelled休日出勤は除外。半日・複数日有給の曖昧さは既存月別検証の問題として扱い、CSVに別ルールを作らない。

後続 `fix_driving_month_calendar_holiday_attendance.sql` は会社休日と一致し、勤務情報も申請紐付けもない休み行を免除する。本番適用状況とM.rule_version=1だけではこの違いを識別できない点を確認する。出力時は保存されたDを優先する。

正式出力前にMの期間・全日数・日付重複・issueなし、D.report_idとRの社員/日付、R.status=submitted、日報全件のDへの包含、明細一意性・形式・必須値を読み取り検査する。Rがない不要日はD.required=falseかつ許容理由であること。矛盾や読取権限不足を「データなし」に変換しない。

## 4. 共通ファイル仕様（提案v1）

- 正式ファイル名：`運転日報_正式_YYYY-MM_v1_<export_id>.csv`、`給油_正式_YYYY-MM_v1_<export_id>.csv`、`前回給油_正式_YYYY-MM_v1_<export_id>.csv`。同名規則のZIP1件に収録する。export_idは出力時生成UUIDでDB保存しない。3つは同一ID・生成日時で一組。日報・給油は同じ正式対象社員、前回給油はその実績車両を対象とする。給油0件・対象車両0台のCSVはヘッダーのみ。
- 確認用は別操作、ファイル名に `確認用_提出不可`、export_kind=preview。正式はofficial。正式取込はpreviewを拒否する。確認用の実装も今回は行わない。
- UTF-8 BOM、カンマ区切り、CRLF、先頭行固定ヘッダー。全フィールドを二重引用符で囲み、内部引用符は二重化。文字列内改行もCSVとして保持し、Excel側はCSVパーサーで読む。
- 日付YYYY-MM-DD、対象月YYYY-MM、日時YYYY-MM-DDTHH:mm:ss.SSS+09:00（DBの小数秒がミリ秒未満の精度を持つ場合はその桁も保持）。すべてAsia/Tokyoに明示変換。数値は桁区切りなし・小数点`.`、距離1桁、給油量・測定値3桁。四捨五入でDB値を変更しない。
- booleanはtrue/false、NULLは空欄。0/falseを空欄にしない。IDは10進文字列として取り込み、JavaScript NumberやExcel数値変換でbigintを丸めない。文字列「NULL」や「未入力」を数値列に混ぜない。
- 状態列により適用外・日報なし・未入力を区別する。任意textのNULLと空文字の厳密な復元はv1の対象外。必要なら別仕様とする。
- 自由記述をExcel式として実行させない。取込シートは文字列型を指定し、VBA転記先も文字列書式を設定してから値を設定する。CSVの引用符だけでは式解釈を防げないため、実取込で `= / + / - / @` 始まりも検証する。業務文字列への無断のアポストロフィ追加はしない。
- 日報の並びはemployee_id数値昇順→report_date昇順。給油はemployee_id数値昇順→report_date→refueled_at→refuel_id数値昇順。給油時刻同一でもIDで安定する。社員IDの順序比較も精度を失わない方法とする。

## 5. 運転日報CSV 全列・列順

表の順をそのままヘッダー順とする。列名はExcel/VBAで固定参照しやすい英小文字。表示用日本語や○×への変換はExcel側にまとめる。`導出`はDB列ではない。snapshotのスカラーIDは文字列化、配列はJSONをCSVエスケープして出す。

| 列名（順） | 取得元／DB型 | 値の意味 |
|---|---|---|
| schema_version | 定数 | driving_daily_v1 |
| export_kind | 定数 | official（確認用preview） |
| export_id | 出力時UUID | 3ファイルの同一組識別 |
| exported_at | 出力時刻 | 共通JST日時 |
| closing_month | M.closing_month date | YYYY-MM |
| period_start | M.period_start date | 前月21日 |
| period_end | M.period_end date | 当月20日 |
| month_submission_id | M.id bigint | 月別提出ID |
| month_submitted_at | M.submitted_at timestamptz | 月別正式提出日時 |
| month_rule_version | M.rule_version integer | 月別判定版 |
| employee_id | M.employee_id bigint | 氏名と別の結合キー |
| employee_name | employees.name text | 出力時点の社員マスタ氏名。日報なし日も同じ |
| department | employees.department text | 出力時点の社員マスタ所属 |
| employee_identity_source | 定数 | current_employee_master |
| report_date | D.date（JSON文字列） | 日報なし日も期間内全日 |
| calendar_day_type | D.calendar（JSON文字列） | 出勤／有給奨励日／休日／祝日、未設定空欄 |
| report_required | D.required（JSON真偽値） | 提出時の必須判定 |
| requirement_reason | D.reason（JSON文字列） | confirmed_work等、変換せず保持 |
| day_state | 導出 | driven / no_driving / exempt_company_holiday / exempt_full_leave |
| attendance_id | D.attendance.id（JSON数値） | 提出時出勤簿ID、なければ空欄 |
| attendance_status | D.attendance.status（JSON文字列） | 出勤簿の提出時状態 |
| attendance_site_type | D.attendance.site_type（JSON文字列） | 会社勤務／一般／雑工事／休み |
| leave_type | D.attendance.leave_type（JSON文字列） | 有給／代休等。全日休暇で空なら下記参照 |
| leave_application_id | D.leave_application_id（JSON数値） | 全日休暇の根拠。半日休暇では空になり得る |
| source_application_id | D.attendance.source_application_id（JSON数値） | 半日等の根拠を含む出勤簿連携ID |
| holiday_work_record_ids | D.holiday_work_record_ids（JSON配列） | active休日出勤ID。なしは[] |
| report_id | R.id bigint | 日報なし日は空欄 |
| report_status | R.status text | draft/submitted、正式実日報はsubmitted |
| driving_status | R.driving_status text | driven / no_driving、免除日は空欄 |
| vehicle_id | R.vehicle_id bigint | 当日の車両 |
| vehicle_number | R.vehicle_number_snapshot text | 当時の車両番号 |
| vehicle_name | R.vehicle_name_snapshot text | 当時の車両名、旧記録NULLは空欄 |
| outbound_route_type | R.outbound_route_type text | office=会社経由、direct=直行、direct_return=直行直帰、other=その他 |
| return_route_type | R.return_route_type text | 同じ保存値集合。帰り側directの表示も現画面では「直行」なので帳票表現を要確認 |
| route_note | R.route_note text | 経路補足 |
| site_id | R.site_id bigint | 現場ID |
| site_name | R.site_name_snapshot text | 当時の現場表示名 |
| destination_text | R.destination_text text | その他の行先、site_idと排他 |
| start_odometer | R.start_odometer numeric(12,1) | 出発km |
| end_odometer | R.end_odometer numeric(12,1) | 帰着km |
| distance_km | R.distance_km numeric(12,1)生成列 | end-start。運転なしはNULL |
| accident_or_violation | R.accident_or_violation boolean | 事故・違反ありtrue、免除日は空欄 |
| accident_violation_note | R.accident_violation_note text | 事故・違反内容 |
| report_note | R.note text | DBにはあるが現画面の保存collectは更新しない |
| report_submitted_at | R.submitted_at timestamptz | 初回日別提出日時、月別と区別 |
| report_updated_at | R.updated_at timestamptz | 親日報更新日時。全明細更新時刻を代表しない |
| late_entry | R.late_entry boolean | 現行日別基準の遅延フラグ |
| late_entry_days | R.late_entry_days integer | 初回提出JST日-report_date、下限0。月別遅延判定に使わない |
| refuel_count | Fを親別countした導出integer | 実日報で給油なし0、免除日は空欄 |
| refuel_total_liters | F.litersを親別sumした導出numeric | 実日報で0件なら0.000、免除日は空欄 |
| alcohol_check_version | R.alcohol_check_version smallint | 1=旧出発前/帰着後、2=出勤運転前/帰り運転前 |

leave_type補完：D.attendanceがなく全日休暇だけある場合、D.leave_application_idから `applications.application_type`（text）を読み、paid_leave→有給、comp_leave→代休とする案。申請が読めない場合に推測しない。現在のsnapshotには休暇種別が常に保存されるわけではなく、厳密な提出時再現には不足がある。実装前に確認する。

### 5.1 点検列（直前の表に続けて配置）

下表の順に、各コードごとに次の3列を連続配置する。これにより列名と列順は一意に定まる（13×3=39列）。結果だけでなく不良備考と点検時刻も保持する。

| コード | 正式名称 | CSV列名（左から） |
|---|---|---|
| brake_horn | ブレーキ機能及びホーンのチェック | inspection_brake_horn_result, inspection_brake_horn_note, inspection_brake_horn_checked_at |
| lights | ライト類のチェック（ヘッド・ストップ・ウィンカー） | inspection_lights_result, inspection_lights_note, inspection_lights_checked_at |
| mirror_visibility | バックミラー・視界のチェック | inspection_mirror_visibility_result, inspection_mirror_visibility_note, inspection_mirror_visibility_checked_at |
| tires | タイヤのチェック | inspection_tires_result, inspection_tires_note, inspection_tires_checked_at |
| exterior_interior | 外観の汚れ、損傷・車内清掃はどうか | inspection_exterior_interior_result, inspection_exterior_interior_note, inspection_exterior_interior_checked_at |
| driving_posture_seatbelt | 運転姿勢とシートベルトのチェック | inspection_driving_posture_seatbelt_result, inspection_driving_posture_seatbelt_note, inspection_driving_posture_seatbelt_checked_at |
| mobile_phone | 携帯電話の処置はよいか | inspection_mobile_phone_result, inspection_mobile_phone_note, inspection_mobile_phone_checked_at |
| oil_leak | 車両からの油漏れはないか | inspection_oil_leak_result, inspection_oil_leak_note, inspection_oil_leak_checked_at |
| sleep_fatigue | 寝不足ではないか・疲労はないか | inspection_sleep_fatigue_result, inspection_sleep_fatigue_note, inspection_sleep_fatigue_checked_at |
| physical_condition | 顔色はよいか、目の玉は生き生きしているか | inspection_physical_condition_result, inspection_physical_condition_note, inspection_physical_condition_checked_at |
| alcohol_condition | 運転前後の酒気帯びはないか | inspection_alcohol_condition_result, inspection_alcohol_condition_note, inspection_alcohol_condition_checked_at |
| medication | 薬は服用していないか | inspection_medication_result, inspection_medication_note, inspection_medication_checked_at |
| worries | 悩み事はないか | inspection_worries_result, inspection_worries_note, inspection_worries_checked_at |

取得元は各I.inspection_item_codeに対応するI.result（text：ok=良好、defect=不良、not_applicable=該当なし）、I.note（text）、I.checked_at（timestamptz）。不良は備考必須。空欄を良好にしない。運転なし・免除日は39列とも空欄、day_stateにより未入力と区別する。帳票の○×等の対応は原本で確定する。

### 5.2 アルコール列（点検列に続けて配置）

新旧の行を保持するため、以下4グループをこの順で配置する。

1. `commute_before`：出勤運転前（新）
2. `return_before`：帰り運転前（新）
3. `before`：旧出発前
4. `after`：旧帰着後

各グループは以下12列を順に持つ。`{type}` を上記文字列で置換した名前が全48列の正式な提案列名となる（例：alcohol_commute_before_check_id）。4×12列を省略や順序変更せず展開する。

| 列名パターン | 取得元／型 | 意味 |
|---|---|---|
| alcohol_{type}_check_id | A.id bigint | 当該区分の行ID |
| alcohol_{type}_input_state | 導出text | complete / partial / absent / not_applicable |
| alcohol_{type}_checked_at | A.checked_at timestamptz | JST日時。旧方式を新方式の時刻に転用しない |
| alcohol_{type}_value | A.alcohol_value numeric(6,3) | 0.000も値。単位はDB定義に明記なし、原本で確認 |
| alcohol_{type}_is_zero | A.is_zero boolean生成列 | value=0。未入力はNULL |
| alcohol_{type}_phone_confirmed | A.phone_confirmed boolean | true=○、false=×、NULL=未入力／旧方式では非適用 |
| alcohol_{type}_confirmation_method | A.confirmation_method text | 新方式は電話確認○/×をDB生成。旧方式は元の方法を保持 |
| alcohol_{type}_confirmed_by_employee_id | A.confirmed_by_employee_id bigint | 旧方式の社員参照。新方式は必ずNULL |
| alcohol_{type}_confirmed_by_name | A.confirmed_by_name_snapshot text | 新方式は中尾／安藤、旧方式は元の名称 |
| alcohol_{type}_excel_confirmer_code | 導出integer | 新方式のみ中尾=1、安藤=2、他は空欄。DrivingAlcoholと同じ |
| alcohol_{type}_note | A.note text | 保存された検査備考 |
| alcohol_{type}_record_type | A.check_type text | 実在行の区分コード。行なし空欄 |

input_state：運転なし/免除日はnot_applicable。運転ありで当該行があれば新方式は時刻・値・電話真偽・確認者の4要件、旧方式は既存必須列でcomplete/partialを判定。行がなく、その方式で必須の区分はabsent、非必須の他方式はnot_applicable。方式2でも旧行が残っている場合はその内容を出し、入力状態を判定する。方式1を方式2に置換しない。正式出力で当該方式の必須区分がabsent/partialなら不整合として中止する。電話falseは有効入力なので「確認漏れ」にしない。

## 6. 給油CSV 全列・列順

給油実レコードのみ1回1行。免除日や給油0回の日を架空の給油行にしない。現行画面が入力しているのは給油量・メーター・日報に固定された日付であり、給油所・支払方法・備考はDBにあっても現画面の入力欄にはない。金額・単価・油種の列は現行Fにない。

| 列名（順） | 取得元／DB型 | 値の意味 |
|---|---|---|
| schema_version | 定数 | driving_refuel_v1 |
| export_kind | 共通 | official / preview |
| export_id | 共通 | 日報CSVと同一UUID |
| exported_at | 共通 | 同一JST生成日時 |
| closing_month | M.closing_month date | YYYY-MM |
| period_start | M.period_start date | 前月21日 |
| period_end | M.period_end date | 当月20日 |
| month_submission_id | M.id bigint | 月別提出ID |
| month_submitted_at | M.submitted_at timestamptz | 月別提出日時 |
| employee_id | R.employee_id bigint | 日報CSVとのキー |
| employee_name | employees.name text | 出力時点の社員マスタ氏名 |
| department | employees.department text | 出力時点の社員マスタ所属 |
| report_date | R.report_date date | 対象期間の所属日は親日報で判定 |
| report_id | R.id bigint | 親日報ID |
| vehicle_id | R.vehicle_id bigint | 給油独自の車両列はない |
| vehicle_number | R.vehicle_number_snapshot text | 当時の番号 |
| vehicle_name | R.vehicle_name_snapshot text | 当時の名称、旧NULLは空欄 |
| refuel_id | F.id bigint | 給油の一意キー、再取込時の重複防止 |
| refuel_sequence | 導出integer | 親日報内refueled_at,id順の1始まり番号。実際の時間順を保証しない |
| refueled_date | F.refueled_at timestamptzから導出date | JSTの給油日 |
| refueled_at | F.refueled_at timestamptz | 保存値。実給油時刻とみなさない |
| liters | F.liters numeric(9,3) | L、0超 |
| odometer_km | F.odometer_km numeric(12,1) | 給油時km、DBではNULL可、現画面は必須 |
| fuel_station | F.fuel_station text | 給油所、現画面では入力なし |
| payment_method | F.payment_method text | 支払方法、現画面では入力なし、値の統一規約なし |
| refuel_note | F.note text | 給油備考、現画面では入力なし |

領収書ID・画像URL・保存パス・原本受領状態はv1の3CSVに含めない。帳票に必要か未確認であり、読取権限・保存後整理により変動する状態と確定日報を分離する。画像は既存機能で維持する。必要なら `fuel_receipts.refuel_id` と `fuel_receipt_reviews.refuel_id` を通じた別仕様を追加検討するが、画像未添付を給油除外条件にしない。active/archived等を単純JOINすると給油行が増えるため注意する。

### 6.1 「先月の最終給油」の取得（追加提案）

帳票の欄名は「先月の最終給油」だが、検索は直前の暦月だけに限定せず、**対象期間開始日より前の同一車両の履歴全体**から最新を求める。2026-10対象なら2026-09-21T00:00:00+09:00より前。登録・更新日時ではなく、F.refueled_atが示す給油日で判定する。履歴はF.driving_report_id→R.idで結合し、R.vehicle_idで検索する。社員IDだけ、氏名、現在の既定車両、車両番号文字列だけでは検索しない。他社員が同じ車両を使用した給油も候補に含む。

対象車両集合は、今回正式出力する社員の期間内実日報に保存されたvehicle_idの重複を除いたものとする。給油がない月でも運転車両の前回情報を取得する。全日運転なし・免除で車両実績がない社員に既定車両から架空の紐付けを作らない。

正式な基準履歴は、親日報がsubmittedかつ、その社員・給油所属月の月別提出記録があり、snapshotに当該日報が含まれる履歴を候補とする案。日付と親日報日の不一致等は第7節と同様に要確認。対象月の提出社員に限定せず、過去の別社員・inactive社員・inactive車両も対象とする。過去の月別提出を確認できない日別提出のみの移行前履歴は、自動で正式履歴へ昇格させない。

| 状況 | 扱い |
|---|---|
| 正式候補あり | F.refueled_at降順、同値ならF.id数値降順で1件を決定。監査用に元の日報・給油IDを保持 |
| 同日の複数給油 | 給油日時が異なれば日時順。ただし現画面は00:00保存なので同値時の最大IDは再現可能な選択規則にすぎず、実際の最終給油順を保証しない。順序未確認を表示し、計算基準として自動採用しない |
| 履歴なし | status=no_history、給油日・量・メーター・元IDは空欄。0や架空の給油行を作らない |
| 下書き・月別未提出履歴あり | 正式基準には採用しない。正式候補より新しい未確定履歴があればstatus=unconfirmed_historyとして注意し、古い正式候補を無断で「実際の最後」と扱わない。正式候補もない場合をno_historyと混同しない |
| メーター欠落・逆転・日付矛盾 | 最新行を古い正常行へ黙って差し替えない。status=needs_reviewとし、計算を保留 |
| 読取権限不足・履歴取得失敗 | no_historyにはせず処理を中止。既存RLSを緩めない |
| 車両変更 | 期間内の各vehicle_idに独立した前回給油を求める。旧車両メーターを新車両へ繰り越さない |

同時刻候補数と新しい未確定履歴の有無は、選択済みの元IDと別に保持する。statusの優先はneeds_review→unconfirmed_history→order_unconfirmed→available、正式候補も未確定履歴もなければno_historyとする。欠損・曖昧さはExcelにも引き継ぐ。未確定履歴を含める確認用を将来設ける場合はpreviewとし、正式計算へ流入させない。移行前の日別提出履歴を採用する例外ルールは実装前の決定事項とする。

レビュー修正後のRPC応答はsource_version=2。過去履歴全件をブラウザへ返さず、各車両の最新正式候補と、それより時刻が前の直前正式候補の最大2件だけをhistoryへ返す。history_summaryにはvehicle_id、selected_id、earlier_id、同時刻正式候補数、新しい（同時刻を含む）未確定履歴の有無を必ず返す。候補なし車両もsummaryの行を省略しない。SQL内部では対象車両の過去履歴を検査して集約するため、返却件数が少なくても不確定履歴を見落として古い候補へ確定することはない。欠けたsummary・不一致ID・旧版応答はJS側でも拒否する。

### 6.2 前回給油情報の受渡し方法（追加提案）

**補助CSV `前回給油_正式_YYYY-MM_v1_<export_id>.csv` を採用する**。給油CSVへ過去の給油を当月明細として混ぜると件数・合計に混入し、当月給油0件の車両にも情報を渡せないため。補助CSVは車両ごと1行の参照情報であり、新しい給油レコードではない。履歴なしでも対象車両の状態行は出すが、給油の元IDと値は空欄とする。

次の列順を提案する。共通日時・ID・数値形式は第4節に従う。

| 列名（順） | 取得元／意味 |
|---|---|
| schema_version | 定数driving_previous_refuel_v1 |
| export_kind | official / preview |
| export_id | 日報・給油CSVと共通UUID |
| exported_at | 同じ出力時点のJST日時 |
| closing_month | 指定対象月YYYY-MM |
| period_start | 検索上限となる期間開始日date |
| vehicle_id | 対象車両R.vehicle_id bigint |
| previous_refuel_status | available / no_history / unconfirmed_history / order_unconfirmed / needs_review |
| previous_refuel_id | 選択したF.id bigint、存在しなければ空欄 |
| previous_report_id | その親R.id bigint |
| previous_month_submission_id | 過去履歴の月別提出記録id bigint |
| previous_refueled_date | 選択F.refueled_atのJST日付 |
| previous_refueled_at | 選択F.refueled_at timestamptz（実時刻とは限らない） |
| previous_liters | 選択F.liters numeric(9,3)、L |
| previous_odometer_km | 選択F.odometer_km numeric(12,1)、km |
| same_timestamp_candidate_count | 最新正式候補と同時刻の正式候補件数、なし0 |
| has_newer_unconfirmed_history | 選択候補より新しい、または同時刻の未確定履歴があるか。正式候補なしなら未確定履歴の有無 |

並び順はvehicle_id数値昇順。社員への対応は日報CSVのemployee_idとvehicle_idからExcelで導く。共有車両でも履歴を社員別に複製して合計しない。

追加実装では補助CSV案を採用し、**3ファイル一組のZIP**とする。Excelから本番DBへ直接接続したり、取込時に別時点の履歴を再検索したりしない。共通export_id・取得時点を揃え、従来の日報CSVと給油CSVの列順は変更しない。

### 6.3 Excel側の自動計算（追加方針）

CSVは元の給油量・メーター・車両ID・日付を渡し、給油間走行距離・給油量合計・燃費（km/L）はExcel側で計算する。既存帳票の式・集計範囲・端数処理を優先し、原本確認前に式やセル番地を確定しない。日報CSVのrefuel_total_litersは照合用であり、Excelの給油CSV集計へ重ねて加算しない。

| 計算項目 | 原本確認までの考え方と未確定点 |
|---|---|
| 給油間走行距離 | 同じvehicle_idの今回給油メーター−前回給油メーターが候補。期間内最初の給油は補助CSVを基準にする。欠損・順序不明・負値・メーター交換時は計算保留。車両をまたいで差を取らない |
| 給油量合計 | 当月分は当月給油CSVの実明細のみを集計する案。補助CSVの先月給油量を当月合計へ入れない。燃費の分母に使う給油量の範囲は当月合計と同じとは限らず、既存式で確認する |
| 燃費（km/L） | 対応する走行区間の距離÷対応する給油量が候補。各給油の燃費の単純平均や、月間日報距離÷当月給油量を無条件に採用しない。期間末未給油区間・部分給油・満タン間の複数給油の扱いは未確定 |

現行Fには満タン給油フラグがない。すべて満タンと推定しない。満タン法を採用するなら区間両端の満タン確認と中間給油量の集計が必要で、現在の情報で既存帳票の計算が成立するかを確認する。計算できない値を0や直近正常値で埋めず空欄・要確認表示とし、0除算も防ぐ。

共有車両では、別社員による期間内給油・走行が社員別CSVに揃わないことがある。車両全体の燃費と当該社員の給油間の帳票計算を区別し、対象社員外の期間内履歴が必要なら取得範囲・正式対象との関係を別途決める。先月最終給油1件だけで期間内の欠落が解消すると扱わない。

## 7. 再保存・複数給油・車両・確定の注意

- 給油は1日複数件を全件出す。点検×検査×給油を生JOINしない。点検/検査をそれぞれ一意に横展開し、給油集計は別集約。日報CSVのrefuel_count/totalと給油CSVを照合する。
- 新規給油のrefueled_atは画面が日報日00:00 JSTで生成する。実給油時刻や給油順は入力されていない。refueled_dateと親日報日が異なる旧データは、正式出力前に不整合として確認し、出力時に日付修正しない。
- 給油の再保存は既存IDをPATCHし、削除は領収書整理後に行う。INSERT応答不明時は再読込を要求する。CSVも時刻・量が同じ別IDを勝手に重複削除しない。誤登録重複は別途本人の提出前確認で解決する。
- 日報保存は親PATCH→点検→新検査→給油→領収書と複数HTTP要求であり、一部成功し得る。親updated_atだけで明細の完全性を保証できない。正式出力は月別確定記録と明細整合性を基準にする。
- 日をまたいだ車両変更はRごとの車両を出す。1日に複数車両・車両別給油は現在のモデルでは表現できない。月途中の車両変更は第9.1節のとおり車両ごとに表裏を分ける。
- 月別ガードは日報/点検/検査/給油のINSERT/UPDATE/DELETEを拒否し、本人の領収書変更も既存own_draft検証で拒否する。月別記録があるなら日別の下書き戻しも不可。解除・訂正・再提出の業務APIは未実装。CSV側に解除処理を加えない。
- 月別提出後も出勤簿・休日設定等の通常変更を許す設計部分があるため、現在の勤務情報でDを再生成しない。領収書の経理整理等も現在状態として別管理する。
- 既存late_entryは日別の初回提出基準。月末一括提出すると過去日が遅延扱いになり得るため、そのままExcelで注意表示や評価に使わない。

## 8. 既存出勤簿方式の調査と流用範囲

`attendance-admin.js` の `getAttendanceRange` は前月21日〜当月20日、`loadMonthlyAttendance` はemployee_id,work_date順。社員マスタはactive=trueかつattendance_required=trueで読む。`exportAllCsv` は読み込んだ出勤簿の各行を出力し、社員マスタに見つからない行は除外する。未提出もCSVに入り、提出状態を別列に出すため、今回の正式対象条件は別途必要。

既存16列は「部、氏名、対象月、日付、区分、工事番号、現場名、勤務内容、休暇区分、雑工事区分、担当部、雑工事名、開始、終了、備考、提出状態」。社員ID列はない。`escapeCsv/downloadCsv` は全値を引用符で囲み、引用符を二重化し、UTF-8 BOM付きBlobをダウンロードする（現行改行はLF）。

流用できるのは対象月UI、締め期間計算の考え方、CSV引用処理、BOM付きダウンロード。今回追加する社員ID、正式対象絞込、全日行、3ファイル整合性、取得上限対策、権限検証は独自に設計する。既存の氏名照合やactive絞込、ブラウザlocalStorageによる管理画面表示判定を正式認可の根拠として流用しない。

Excel側の一括作成処理は見つからず、既存のマクロ方式・取込シート・ボタン・列番号契約は確認できない。「同方式」の運用は維持しつつ、実物を入手してから内部の再利用可否を判断する。

## 9. Excel取込の提案

最終運用は「管理者がCSV一括出力→ExcelへCSV取込→社員約30人分を**1ブック**で自動作成→社員・車両ごとに表・裏2シート→全員分を一括印刷→Excelで提出・保存」とする。基本は社員1人1台で、月途中の車両変更時のみ車両別に帳票を分ける。既存の帳票様式を維持し、正確なセル番地・計算式・印刷範囲は実ファイル確認後に確定する。取込用シートは3CSV分とする。

1. 現行原本のコピーにCSV取込用3シートと設定表を用意し、既存の表・裏テンプレートの帳票様式・印刷範囲を保つ。CSVをダブルクリックして貼る運用にはせず、Power Query（UTF-8/型指定）または既存VBAのCSVパーサーで取り込む。原本未確認のため方式は候補。
2. 3ファイルのexport_id・対象月・期間・official・schema_versionを検証。給油ヘッダーのみの場合は日報側の給油総数0を確認。日報キー(employee_id,report_date)と給油refuel_idの一意性、親の存在、日別件数/合計、前回給油の対象車両を照合する。
3. employee_id,vehicle_idで全員分をグループ化し、社員・車両ごとに表・裏を複製して一括転記する。氏名を結合キーにしない。シート名の禁止文字/31文字/同姓同名は社員・車両ID付きの命名規則で扱う。
4. 設定表でCSV列→帳票項目を対応付ける。表裏への日付割当、○×/該当なし、経路記号、確認者1/2、休日・有給・代休の表記を原本に合わせて定義する。具体的セル番地は原本確認後に決める。
5. 給油明細を回数分転記する。帳票の欄数を超えた場合に切捨て・無断合算しない。欄上限に応じて停止/別紙/承認済集計を選ぶ必要があり、2シート維持と両立する正式運用を先に確定する。
6. 同じ社員・月の再取込は追記せず当該出力分を置換し、古い日別値・給油行を残さない。取込途中失敗では既存完成帳票を上書きしない。件数・合計・不足一覧を確認してからExcelで提出・印刷・保存する。

約30人×28〜31日で約840〜930日別行。明細は上限が別にあるため、APIの既定上限に依存しない。Excelの全員生成は約60シートとなる。実際の印刷ページ数・両面組合せ・余白・改ページは原本で検証する。

上記約60シートは全員1台の場合。車両変更があれば、第9.1節に従い追加車両ごとに2シート増える。CSVの社員1人1日1行は維持し、車両別帳票を作るためにCSV日別行を複製しない。

### 9.1 月途中の車両変更とヘッダー

日別の車両番号は実際の日報snapshotを優先し、現在の既定車両で月全体を上書きしない。社員ごとに期間内vehicle_idを検査し、1台ならその車両情報をヘッダーへ、複数なら「最初／最後の1台」へ自動固定しない。

基本は社員1人・車両1台。リース更新などで月途中に車両が変わった場合のみ、車両ごとに既存の表裏を複製する。1台なら2シート、2台なら4シート、3台なら6シート（車両台数×2）。同じ社員・車両へ戻った場合は同じ組にまとめ、給油履歴・メーター・燃費を別車両と混在させない。前回給油はvehicle_idで対応させる。

日報CSVの社員ID・車両ID・日付と給油CSVの対応により、Excel側で分割する。車両IDがない休日・休暇・運転なし行は、車両を推測して埋めず社員共通の日別状態として保持する。複数の車両帳票へ表示する場合も給油量・走行距離の重複加算はしない。全期間車両なしの社員は空の車両欄で表裏1組を作る案とし、日別状態の表示位置・車両使用外の日の扱いは原本確認後に確定する。全員一括印刷は全対象帳票の確認完了後に実行する。Excel側の転記・マクロ作成は今回実装しない。

## 10. 将来実装の読取・権限設計

全体管理者認証付きの読取専用出力入口 `admin_driving_report_csv_source(date)` を独立差分SQLに実装した。既存本人向けcheck/submit RPCへ他社員IDを渡す迂回や、出力のための提出RPC呼出しは行わない。M/R/I/A/F・社員マスタ・過去給油を同じ一貫したDBスナップショットで読み取り、3CSVを一組として組み立てる。出力時に再取得し、画面確認時から提出者が変わった場合は確認をやり直す。

単純な別々のブラウザ取得では取得時点やページング途中の変化を揃えにくい。読取RPCは既存RLS・GRANT自体を変更せず、Authと全体管理者チェックを維持する。出力用に既存テーブルへの書込権限を付与せず、service_roleキーをブラウザに置かない。対象行が読めない場合は中止する。既存月別ロック関数はgate行をINSERTするため、読取出力で呼ばない。領収書のexportコマンドも監査等の書込を行うため今回のCSV読取に使わない。

初版のSECURITY INVOKERはSELECT権限不足ならエラーにできるが、RLSによる行除外を検出できず、特に月別提出全体・過去給油・休暇情報・社員候補を「0件」と誤認し得る。レビュー修正では**新規RPCだけをSTABLE / SECURITY DEFINER、空search_path、関数内row_security=off**とする。認証済みAuth UIDかつ既存is_application_admin()がtrueの呼出しだけを許し、引数は締め月のみ、静的SELECTだけを実行する。クライアントへのテーブルGRANTや既存RLSの緩和は行わない。

これは認可済みの全体管理者向けに関数所有者の読取権限を使う構成であり、呼出者のRLSをそのまま使う構成ではない。所有者が必要なSELECTを持たない、またはRLSの影響を受けずに読めない場合、row_security=offにより行を隠して処理を続行せずエラーにする。設定は関数呼出しの間だけであり、ALTER TABLE DISABLE RLSや利用者ロールへのBYPASSRLS付与はしない。本番の実所有者・各表の所有権/FORCE RLS・ヘルパー定義を確認してからこの構成を採否決定する。authenticatedには新RPCのEXECUTEのみ追加し、PUBLIC/anon/service_roleからは剥奪する。

## 11. 不足情報・実装前に確認する問題

| 優先 | 確認事項 | 未解決時の影響 |
|---|---|---|
| 必須 | 運転日報Excel原本、記入済例、表裏の項目・記号・月表示・日割・欄数 | セル対応と情報充足性を確定できない |
| 必須 | 出勤簿Excel原本と実際のCSV取込手順/VBA/Power Query、Windows Excel版 | 同じ一括作成方式を具体化できない |
| 必須 | 本番の適用済み列・型・制約・トリガー・RPC・RLS・権限、休日修正を含む適用履歴 | 準備SQLと実環境の差異。今回は接続せず未確認 |
| 必須 | 運転日報対象約30人の名簿、退職・異動・月途中入社、未提出者の扱い | 全員完了判定と対象範囲が曖昧 |
| 必須 | 1日複数車両の業務要否、車両使用外の日の帳票表示 | 現モデルは1日1車両。月途中変更は車両ごと2シートで対応する |
| 必須 | 給油欄の上限、金額・単価・油種・給油所・署名/押印の要否 | 金額/単価/油種/署名画像の保存列なし。給油所等は入力なし |
| 必須 | アルコール値の単位、電話×の帳票表現、確認者コード、旧方式の印刷 | 朝/帰り前と出発前/帰着後を無断変換できない |
| 必須 | 社員マスタ氏名・所属を使う過去月再出力の運用、全日休暇の種別snapshot不足 | 現在表記への変更と過去再現性、所属未設定の扱いを確認する必要がある |
| 必須 | 未提出・移行前履歴と同時刻給油の業務確認方法 | 補助CSVは採用済み。該当履歴は要確認とし、CSVで勝手に確定しない |
| 必須 | 既存Excelの給油間距離・燃費の式、満タン前提、分母の給油量範囲、丸め規則 | 部分給油・先月分・期間末未給油区間を誤集計する可能性がある |
| 必須 | 共有車両の期間内履歴範囲、メーター交換の取扱い | 社員別明細だけでは車両全体の燃費計算が成立しない場合がある |
| 必須 | 月別提出後の誤りの訂正・解除・再提出運用 | 現行ガードでは編集不可、正式訂正APIなし |
| 確認 | 日別late_entryの月別運用への表示方針 | 月別正常提出を日別遅延と誤認し得る |
| 確認 | 半日有給の承認同期制約と月別判定、会社休日設定の実運用 | notes上の既存半日同期拒否や不明日の提出停止をCSVで解決できない |
| 確認 | メーター/日付不一致、旧車両名NULL、既存重複給油の件数 | 出力時に修正せず本人訂正または正式例外手順が必要 |

原本確認後は「帳票項目→CSV列→変換→表裏の転記先→不足時処理」の対応表を作り、通常日・運転なし・会社休日・全日/半日休暇・複数給油・車両変更・旧検査・0/false/空欄・引用符/改行・再取込を、実原本のコピーで確認する。これが終わるまでセル番地と帳票への情報充足は確定しない。

## 12. 今回の実装と本番適用前の確認

- `../driving-report-csv-admin.html/js/css`：管理者メニューから開く専用画面。既存portalFetchによる認証を使い、既存is_application_admin RPCと新しい出力RPCの両方で全体管理者を確認する。
- `../driving-report-csv.js`：日報138列・給油26列・前回給油17列を固定順で生成。数値JSONトークンを精度を失わない文字列として読み、ID比較と給油量集計にはBigIntを使う。ZIPは非圧縮の標準ZIPで、外部ライブラリ/CDN接続なし。
- `add_driving_report_csv_export.sql`：独立したSTABLE / SECURITY DEFINERの読取RPC。認証付き管理者チェックとrow_security=offで完全取得またはエラーとする。単一SELECTのJSON応答に全配列を含め、PostgRESTの行上限による明細切捨てを避ける。過去履歴明細は車両ごと最大2件＋集約。64MiBを超える応答はエラーとし、分割して不完全なCSVを返さない。テーブル権限・既存RLS・既存関数を変更しない。
- 対象者名簿は未確定のため、在籍社員と当月月別提出社員を画面候補に出し、管理者が未提出も含めた対象者を選択する。未提出人数はその選択集合を基準に表示し、確認チェックがなければ出力しない。提出済み社員は選択解除不可で必ず全員出す。選択はブラウザメモリーだけに保持し、マスタを書き換えない。退職済み未提出者も人数に含める必要がある場合は、正式な対象者名簿を別途定義する必要がある。
- 出力操作時に再取得・再検証し、3CSVとZIPを生成する。同じ操作内の生成日時はDBのstatement_timestamp、出力IDはクライアント生成UUID。再出力は新しいIDであり、出力履歴を業務DBへ書き込まない。確認用CSVは実装していない。

本番適用前に、基礎日報・日別提出・自由入力行先・新検査・車両名snapshot・領収書・月別提出の各既存移行と必要な休日修正が適用済みかを別途照合する。今回のSQLはそれらを適用するものではない。新RPCのレビュー後、別途認可された作業でこの差分SQLを信頼された所有者が適用し、authenticatedの全体管理者としてRPC経由で完全取得でき、一般社員・部署管理者・anonの呼出しを拒否することを確認してから画面を公開する。通常のREST SELECTに全件権限を加える必要はない。権限不足を解消するためにRLSを緩めない。新しい環境変数・service_roleキー・Storage設定は不要。

検証コマンド：`node tests/driving-report-csv.test.mjs`（純粋データ生成・SQLの静的検査）、`python tests/driving-report-csv-ui.test.py`（ローカルHTTP模擬RPCとWindows Chromeによる画面/ZIP検証）、`node tests/driving-report-csv-db.test.mjs`（独立した新規PGlite DB。PGLITE_MODULEでローカルの公式パッケージdist/index.jsを指定可）。本番適用前レビュー依頼による隔離DB検証のみを許可し、本番適用は行わない。PGliteはPostgreSQL 18.6 / PGlite 0.5.10。基礎日報と日別検証は実移行SQL、月別提出は実テーブル/制約/RLSの部分を使用し、周辺employees/applications/領収書は最小fixtureであり本番の全DDLを再現したものではない。SQL実行・権限・RLSの代表ケースを検証するが、本番定義・同時更新・実データ負荷・既存機能全体・Excel取込/印刷の検証は別途必要。

初回実装時の実行結果：CSV生成テスト19群、Chrome画面テスト7ケースが成功。約30人900日別行、車両変更、複数給油、前回履歴の欠損/未提出/同時刻/メーター逆転、新旧検査、マイクロ秒・bigint精度、休日/有給/代休/運転なし、重複・欠損停止、再出力、ZIPの展開・CRC・BOMを確認した。画面では管理者否認・RPC側否認・RPC未適用・不整合・提出0人・取得間の提出者変化も確認した。権限拒否の画面試験は模擬応答によるもので、DBの実際の認可検証の代替ではない。既存機能本体の変更はなく、既存管理者メニューへリンク1件を追加している。

本番適用前レビュー修正後の結果：隔離PostgreSQL試験15群、CSV生成20群、Chrome画面9ケースが成功。30人930日別行・61給油行・31車両、SELECT/RLS欠落、所有者の権限不足、前回履歴200件の集約、旧版RPC拒否等を追加検証した。テスト用に取得したPGliteパッケージは検証後にtmpから削除したため、再実行時は公式パッケージ0.5.10を別途用意する。実会社KazuAttendanceの接続・カタログ照合は未完了であり、現段階では本番適用保留。詳細は `driving_report_csv_export_review.md` を参照。

## 13. 社員39の下書きによる開発専用検証

別途依頼された下書き検証は、正式CSVの提出判定を変更せず、共通の列・投影・変換・ZIPを使う専用入口として追加する。社員39・2026年9月分の指定保存済み5日だけをTEST_DRAFTとして出力し、残り26日は生成しない。未入力は保持し、前回給油は今回検索せずunverified・値空欄で渡す。

正式管理画面と `admin_driving_report_csv_source(date)` は変更しない。独立RPCのSQLは作成のみで、本番へ適用しない。localhost＋明示URL指定＋通常の全体管理者認証が必要で、公開画面からは動かない。これは正式用Excelへの取込許可ではなく、検証用コピーへの取込だけを目的とする。正式Excelはexport_kind='official'以外を拒否する必要があり、今回マクロは作成しない。

安全設計・実データを使う次の手順・停止点・試験内容は `driving_report_draft_test_notes.md` を参照。
