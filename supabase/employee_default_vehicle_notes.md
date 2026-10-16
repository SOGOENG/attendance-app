# 通常使用車両：既存更新方式の調査と適用前確認

2026-10-16。リポジトリを調査。本番DBには接続・実行していません。

## 確認できた既存処理

- `settings.js` はemployeesの `name, department, job_title, profile_email, phone_number` をSELECTし、本人が編集できるのはメール・電話のみです。保存は `update-own-profile` Edge Function経由であり、RPCや本人による直接UPDATEではありません。
- `supabase/functions/update-own-profile/index.ts` はBearer tokenを `auth.getUser()` で検証し、`auth_user_id` から本人を一意に特定します。入力の許可列を `profile_email, phone_number` に限定し、未知の項目を拒否。service roleでその2列だけを更新します。氏名・部署・役職をリクエストに混ぜても更新できません。ただしこれはEdge Function内の制限であり、DBの直接UPDATEまで保護する根拠にはなりません。
- `employee-admin.js` の管理者用プロフィール変更は `admin-update-employee-profile` Edge Function経由。同関数は有効社員かつ `admin_scope='all'` を検証し、氏名・部署・役職・メール・電話を許可リストで更新します。active・admin_scope・各入力対象フラグ等は既存の直接PATCH処理も使用します。
- リポジトリで使用される社員列：`id, auth_user_id, name, department, job_title, profile_email, phone_number, active, admin_scope, attendance_required, improvement_required, near_miss_required, is_leave_manager`。これは全列の完全な一覧ではありません。
- `application_management.sql` の `current_employee_id()` は `auth.uid()` に紐づくactive社員IDを返します。`is_application_admin()` は同じ本人Authとactive、admin_scope='all'を使用します。どちらも変更しません。氏名による特例は追加しません。

## 未確認の点と方針

employeesの作成DDL・元のRLSポリシー・プロフィール保護triggerの定義はリポジトリ内に見つかりません。実DBの列・grant・RLS・triggerの全体像、および直接UPDATEの保護を断定できません。新migrationはそれらを緩和・置換しません。既存triggerが未知の列の更新を拒否する場合も迂回せず、その定義を確認してから適用可否を判断してください。

専用の `set_my_default_vehicle(p_vehicle_id bigint)` はSECURITY DEFINER・空search_path・完全修飾名を使用し、本人のactive/Auth紐付けをロックして再確認します。新列だけを更新し、社員テーブルに直接UPDATE権限を追加しません。既存のテーブル単位UPDATE権限があるロールには、新列もその既存権限・RLSの範囲で見えることに注意し、適用前に以下を確認してください。

引数は車両IDのみ、NULLで解除できます。有効車両のみ選択可能。車両行の共有ロックで確認と保存の間の無効化を抑止します。保存後の無効化は許可しFKを保持します。FKはRESTRICTで、物理削除による設定の消失を防ぎます。

将来の画面は新規日報の場合に通常使用車両を初期選択し、既存draftの車両を優先してください。無効車両の設定は保持しますが、自動選択対象からは除外する方針です。このmigrationは画面・日報保存・過去snapshotに作用しません。

## 適用前の読取確認用SQL（今回未実行）

```sql
select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema='public' and table_name='employees' order by ordinal_position;

select relrowsecurity, relforcerowsecurity, pg_get_userbyid(relowner) as owner
from pg_class where oid='public.employees'::regclass;
select * from pg_policies where schemaname='public' and tablename='employees';
select grantee, privilege_type from information_schema.table_privileges
where table_schema='public' and table_name='employees';
select grantee, column_name, privilege_type from information_schema.column_privileges
where table_schema='public' and table_name='employees';

select t.tgname, pg_get_triggerdef(t.oid), pg_get_functiondef(t.tgfoid)
from pg_trigger t where t.tgrelid='public.employees'::regclass and not t.tgisinternal;
select pg_get_functiondef('public.current_employee_id()'::regprocedure);
```

隔離DBのテストは代表的な権限・RLSをfixtureとして検証します。本番にしかないRLS・triggerや実Authとの結合を検証したものではありません。
