# 代休の予約残数競合修正

本番Supabaseには未適用。

## 既存環境への適用

1. 検証DBで `fix_comp_leave_reservations.sql` を実行する。
2. 検証後、本番には同じ差分SQLだけを適用する。既存の直接登録用カラム・CHECK・トリガー・履歴RPCは再作成しない。RLS変更もない。
3. SQL適用後に画面ファイルを公開する。新画面は `get_comp_leave_availability` を必要とする。SQL未適用時は管理者直接登録を無効にし、旧残数へのフォールバックはしない。

新規構築用の `application_management.sql` と `add_admin_comp_leave_usage.sql` も更新済み。共通関数の原本は `comp_leave_availability_functions.sql`。同じ定義を基盤SQL・差分SQLへ収録しているので、この原本を別途適用する必要はない。テストで定義の一致を確認する。

## 計算と状態遷移

- `reserved_days` は同じ休日出勤に対する `application_type='comp_leave' AND status='submitted'` の割当合計。
- `available_days = greatest(remaining_days - reserved_days, 0)`。過去の予約超過がある行は新規消化に使わない。他の休日出勤の使用可能分まで負数で相殺しない。
- approvedは既存の `remaining_days` に反映済みなので追加控除しない。draft / revision_required / rejected / cancelled は予約対象外。
- 内部関数の除外申請IDは提出RPCで自分のIDを渡す。公開RPCには除外引数を設けず、本人・残数管理者・申請管理者だけが社員単位の集計結果を取得できる。申請明細は公開しない。
- 通常提出は申請行をロック後、対象休日出勤をID昇順でロックし、別SQL文でactive・本人所有を再確認。既存再計算で残数を整え、共通関数で割当上限を検証してからsubmittedにする。
- 管理者直接登録もID昇順ロック後に再計算し、共通関数のavailable_daysで合計チェックと各行のFIFO上限を決める。FIFO順はwork_date,idのまま。
- 共通内部関数はVOLATILE。ロック取得待ちの前に予約を確定せず、ロック後の呼出しで参照する。通常のREAD COMMITTEDを前提とする。
- 差戻し・却下・取消でsubmittedから離れれば、次の取得時に予約は自動的に除外される。予約列の更新や残数再計算を追加する必要はない。
- 承認済み残数再計算・訂正・取消・有給・RLSは変更していない。

既に不足しているsubmitted申請を自動修復・再割当する処理は含まない。次の読取SQLで既存超過を確認できる。

```sql
select h.id, h.employee_id, h.remaining_days, sum(ca.allocated_days) as reserved_days
from public.holiday_work_records h
join public.comp_leave_allocations ca on ca.holiday_work_record_id=h.id
join public.applications a on a.id=ca.application_id
where a.application_type='comp_leave' and a.status='submitted'
group by h.id
having h.status<>'active' or sum(ca.allocated_days)>h.remaining_days;
```

## 自動テスト

`tests/comp-leave-reservations.test.mjs` は @electric-sql/pglite 0.3.14 のメモリ内PostgreSQLで実際のテーブル定義、差分SQL、提出・承認・直接登録・訂正・取消関数を実行する。認証関数はテスト用に置換。実DBには接続しない。

```powershell
# PGliteを通常のモジュール解決先に置くか、そのdist/index.jsの絶対パスを指定する。
$env:PGLITE_MODULE = 'C:\path\to\pglite\dist\index.js'
node tests/comp-leave-reservations.test.mjs
node tests/admin-comp-usage.test.mjs
node tests/applications-comp-availability.test.mjs
node tests/admin-paid-usage.test.mjs
```

検証済み：指定8ケースを含む15業務・権限シナリオ、差分SQLの再適用、基盤SQLとの定義一致、両画面の入力上限・RPC取得失敗時の無効化、有給直接登録の既存テスト。

## 実PostgreSQLでの同時実行確認（未実施）

PGliteの単一接続テストでは複数接続のロック待ちを検証できない。検証DBのREAD COMMITTED・2接続で次を確認する。

1. 接続AでBEGIN後、1日を割り当てた通常申請をsubmitし、COMMITを保留する。
2. 接続Bで同じ休日出勤を割り当てた別の通常申請をsubmitする。Aの終了まで待機することを確認する。
3. AをCOMMITするとBが残数不足になり、Bがdraftのままであることを確認する。AをROLLBACKした場合はBが提出できることも確認する。
4. Bを管理者直接登録に置き換えて同様に確認する。さらにAを直接登録、Bを通常提出に入れ替える。
5. 0.5日ずつの提出と直接登録、承認と直接登録でも待機後の残数が正しいことを確認する。

認証・RLSの実環境統合と、実ブラウザでの社員切替・再読込も検証DBで確認する。
