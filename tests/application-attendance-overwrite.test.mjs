// PGLITE_MODULE=/path/to/pglite/dist/index.js node tests/application-attendance-overwrite.test.mjs
// Isolated PostgreSQL. Only authentication and pre-existing attendance schema are fixtures.
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
const { PGlite } = await import(process.env.PGLITE_MODULE
  ? pathToFileURL(process.env.PGLITE_MODULE).href : '@electric-sql/pglite');
const read = async p => (await readFile(new URL(`../${p}`, import.meta.url), 'utf8')).replaceAll('\r', '');
const base = await read('supabase/application_management.sql');
const migration = await read('supabase/fix_application_attendance_overwrite.sql');
const fn = (sql, name) => {
  const start = sql.indexOf(`create or replace function public.${name}(`);
  assert.ok(start >= 0, name);
  return sql.slice(start, sql.indexOf('$$;', sql.indexOf('as $$', start)) + 3);
};
for (const file of ['application_management.sql', 'add_application_attendance_sync.sql', 'fix_application_attendance_sync_found.sql']) {
  assert.equal(fn(await read(`supabase/${file}`), 'sync_application_attendance_date'), fn(migration, 'sync_application_attendance_date'));
}
const db = new PGlite();
const q = async (sql, args = []) => (await db.query(sql, args)).rows;
await db.exec(`
  create role anon; create role authenticated;
  create schema auth;
  create function auth.uid() returns uuid language sql as $$ select '00000000-0000-0000-0000-000000000001'::uuid $$;
  create table employees(id bigint primary key,active boolean default true);
  create table sites(id bigint primary key);
  create table holidays(date date, day_type text);
  create table attendance(id bigint generated always as identity primary key,
    employee_id bigint, work_date date, site_type text, site_id bigint,
    misc_company text, misc_department text, company_work text, misc_name text,
    leave_type text, start_time text, end_time text, note text, status text);
  insert into employees(id) values(1),(2);
  create function current_employee_id() returns bigint language sql as $$ select 1::bigint $$;
  create function is_application_admin() returns boolean language sql as $$ select true $$;
  create function can_use_application_features() returns boolean language sql as $$ select true $$;
`);
await db.exec(base.slice(base.indexOf('create table if not exists public.application_types'), base.indexOf('-- 申請から反映した出勤簿行')));
await db.exec(await read('supabase/add_application_attendance_sync.sql'));
for (const name of ['validate_paid_leave_application', 'recalculate_paid_leave_balance',
  'recalculate_holiday_work_record', 'comp_leave_availability_internal', 'submit_application', 'review_application', 'cancel_application']) await db.exec(fn(base, name));
await db.exec(migration);
await db.exec(migration);
await db.exec(await read('supabase/add_application_final_approval.sql'));
await db.exec('update employees set is_application_final_approver=true where id=1');
for (const [type, label] of [['paid_leave', '有給'], ['comp_leave', '代休']]) {
  for (const input of ['empty', 'paid', 'work', 'times']) {
    await db.exec('begin');
    try {
      const [{ id }] = await q(`insert into applications(application_type,employee_id,created_by_employee_id,status)
        values($1,1,1,'draft') returning id`, [type]);
      if (type === 'paid_leave') {
        await q(`insert into paid_leave_application_details(application_id,start_date,end_date,days)
          values($1,'2026-10-15','2026-10-15',1)`, [id]);
        await db.exec(`insert into paid_leave_balances(id,employee_id,fiscal_year) values(1,1,2026);
          insert into paid_leave_balance_transactions(balance_id,transaction_type,days,source_key)
          values(1,'grant',10,'opening'); select recalculate_paid_leave_balance(1);`);
      } else {
        await q('insert into comp_leave_application_details(application_id) values($1)', [id]);
        await q("insert into comp_leave_dates(application_id,leave_date,days) values($1,'2026-10-15',1)", [id]);
        await db.exec(`insert into holiday_work_records(id,employee_id,work_date,earned_days,remaining_days,created_by_employee_id)
          values(1,1,'2026-10-01',10,10,1)`);
        await q('insert into comp_leave_allocations(application_id,holiday_work_record_id,allocated_days) values($1,1,1)', [id]);
      }
      await db.exec(`insert into attendance(employee_id,work_date,note) values
        (2,'2026-10-15','other employee'),(1,'2026-10-16','other date')`);
      const others = await q('select * from attendance order by id');
      let oldId;
      if (input !== 'empty') {
        [{ id: oldId }] = await q(`insert into attendance(employee_id,work_date,site_type,site_id,
          misc_company,misc_department,company_work,misc_name,leave_type,start_time,end_time,note,status)
          values(1,'2026-10-15',$1,7,'company','department','work','name','',$2,$3,'manual','submitted') returning id`,
        [input === 'paid' ? '有給' : '内勤', input === 'times' ? '08:00' : '', input === 'times' ? '17:00' : '']);
      }
      assert.equal((await q('select final_approval_required from applications where id=$1',[id]))[0].final_approval_required,false);
      await q('select submit_application($1)',[id]);
      assert.equal((await q('select final_approval_required from applications where id=$1',[id]))[0].final_approval_required,true);
      await q("select review_application($1,'approved')", [id]);
      const rows = await q("select * from attendance where employee_id=1 and work_date='2026-10-15'");
      assert.equal(rows.length, 1);
      const row = rows[0];
      if (oldId) assert.equal(row.id, oldId);
      assert.equal(row.site_type, '休み'); assert.equal(row.leave_type, label);
      assert.equal(row.site_id, null); assert.equal(row.status, 'draft');
      for (const key of ['misc_company','misc_department','company_work','misc_name','start_time','end_time','note']) assert.equal(row[key], '');
      assert.equal(row.source_type, 'application'); assert.equal(row.source_application_id, id);
      await q('select sync_approved_application_attendance($1)', [id]);
      await q('select sync_approved_application_attendance($1)', [id]);
      assert.deepEqual(await q("select * from attendance where employee_id=1 and work_date='2026-10-15'"), rows);
      assert.deepEqual(await q('select * from attendance where id=any($1) order by id', [others.map(r => r.id)]), others);
      const balanceTable = type === 'paid_leave' ? 'paid_leave_balances' : 'holiday_work_records';
      assert.equal(Number((await q(`select remaining_days from ${balanceTable} where id=1`))[0].remaining_days), 9);
      assert.equal((await q('select final_confirmed_at from applications where id=$1',[id]))[0].final_confirmed_at,null);
      await q('select confirm_application_final($1)',[id]);
      assert.ok((await q('select final_confirmed_at from applications where id=$1',[id]))[0].final_confirmed_at);
      await q('select set_application_printed($1,true)',[id]);
      // Additional confirmation must not consume balances or touch attendance again.
      assert.equal(Number((await q(`select remaining_days from ${balanceTable} where id=1`))[0].remaining_days), 9);
      assert.deepEqual(await q("select * from attendance where employee_id=1 and work_date='2026-10-15'"),rows);
      await q("select cancel_application($1,'test')", [id]);
      assert.equal((await q('select final_confirmed_at from applications where id=$1',[id]))[0].final_confirmed_at,null);
      const [cancelled]=await q('select printed_at,printed_by_employee_id from applications where id=$1',[id]);
      assert.equal(cancelled.printed_at,null);assert.equal(cancelled.printed_by_employee_id,null);
      await q("select cancel_application($1,'retry')", [id]);
      assert.deepEqual(await q('select * from attendance order by id'), others);
      assert.equal(Number((await q(`select remaining_days from ${balanceTable} where id=1`))[0].remaining_days), 10);
      console.log(`PASS: ${type}/${input}: approval, columns, isolation, replay, balance, cancellation`);
    } finally { await db.exec('rollback'); }
  }
}
await db.close();
