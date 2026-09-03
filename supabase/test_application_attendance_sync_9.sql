-- 申請ID 9のattendance同期を、変更を残さず検証するSQL
-- 申請9がapprovedであることを確認してからファイル全体を実行してください。

begin;

select id, employee_id, application_type, status
from public.applications
where id = 9;

select public.sync_approved_application_attendance(9);

select id, employee_id, work_date, site_type, leave_type, status,
       source_type, source_application_id
from public.attendance
where source_application_id = 9
order by work_date, id;

-- 検証用なのでattendanceへの変更を残さない。
rollback;

-- 実際に申請9の同期結果を保存する場合は、修正差分SQLの適用後に次を単独実行する。
-- select public.sync_approved_application_attendance(9);
