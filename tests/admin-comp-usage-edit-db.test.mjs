// PGLITE_MODULE=/path/to/pglite/dist/index.js node tests/admin-comp-usage-edit-db.test.mjs
// Isolated PostgreSQL; no production connection. Only the clock and employee auth are stubbed.
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
const { PGlite } = await import(process.env.PGLITE_MODULE
  ? pathToFileURL(process.env.PGLITE_MODULE).href : '@electric-sql/pglite');
const read = async path => (await readFile(new URL(`../${path}`, import.meta.url), 'utf8')).replaceAll('\r', '');
const base = await read('supabase/application_management.sql');
const reservations = await read('supabase/fix_comp_leave_reservations.sql');
const expiry = await read('supabase/add_comp_leave_expiration.sql');
const migration = await read('supabase/fix_comp_leave_expiration_visibility_and_automation.sql');
const shared = await read('supabase/comp_leave_availability_functions.sql');
const fn = (sql, name) => {
  const match = new RegExp(`create or replace function\\s+public\\.${name}\\(`).exec(sql);
  assert.ok(match, name);
  return sql.slice(match.index, sql.indexOf('$$;', sql.indexOf('as $$', match.index)) + 3);
};
for (const sql of [base, reservations, expiry, migration]) {
  assert.equal(fn(sql, 'get_comp_leave_availability'), fn(shared, 'get_comp_leave_availability'));
}
for (const name of ['expire_comp_leave_records_internal', 'expire_comp_leave_records', 'expire_comp_leave_records_automated']) {
  assert.equal(fn(expiry, name), fn(migration, name));
}
for (const sql of [base, reservations]) {
  assert.equal(fn(sql, 'comp_leave_availability_internal'), fn(shared, 'comp_leave_availability_internal'));
}
const clock = sql => sql.replaceAll('statement_timestamp()', 'public.test_now()')
  .replaceAll('current_date', "(public.test_now() at time zone 'Asia/Tokyo')::date");
const db = new PGlite();
const q = async (sql, args = []) => (await db.query(sql, args)).rows;
await db.exec(`
  create role anon; create role authenticated; create role service_role;
  create table employees(id bigint primary key, active boolean default true);
  create table sites(id bigint primary key);
  create table attendance(id bigint primary key);
  insert into employees values(1,true),(2,true);
  create function current_employee_id() returns bigint language sql stable as
    $$ select nullif(current_setting('test.actor',true),'')::bigint $$;
  create function is_leave_manager() returns boolean language sql stable as
    $$ select public.current_employee_id()=1 $$;
  create function is_application_admin() returns boolean language sql stable as
    $$ select public.current_employee_id()=1 $$;
  create function can_use_application_features() returns boolean language sql stable as
    $$ select public.current_employee_id() is not null $$;
  create function test_now() returns timestamptz language sql stable as
    $$ select current_setting('test.now')::timestamptz $$;
  select set_config('test.actor','1',false);
  select set_config('test.now','2026-09-28T00:00:00Z',false);
`);
await db.exec(base.slice(base.indexOf('create table if not exists public.application_types'),
  base.indexOf('-- 申請から反映した出勤簿行')));
for (const name of ['recalculate_holiday_work_record', 'review_application', 'cancel_application',
  'update_holiday_work', 'cancel_holiday_work']) await db.exec(fn(base, name));
// Existing production direct-registration CHECK has already been replaced.
await db.exec('alter table comp_leave_dates drop constraint comp_leave_dates_days_check');
await db.exec(await read('supabase/add_admin_comp_leave_usage.sql'));
await db.exec(clock(reservations));
await db.exec(clock(expiry));
await db.exec(clock(expiry));
await db.exec(clock(migration));
await db.exec(clock(migration));
const work = async (date = '2025-09-15', days = 1) => (await q(`insert into holiday_work_records
  (employee_id,work_date,earned_days,remaining_days,created_by_employee_id)
  values(1,$1,$2,$2,1) returning id`, [date, days]))[0].id;
const app = async (id, days, date) => {
  const a = (await q(`insert into applications(application_type,employee_id,created_by_employee_id)
    values('comp_leave',1,1) returning id`))[0].id;
  await q('insert into comp_leave_application_details(application_id) values($1)', [a]);
  await q('insert into comp_leave_dates(application_id,leave_date,days) values($1,$2,$3)', [a,date,days]);
  await q('insert into comp_leave_allocations(application_id,holiday_work_record_id,allocated_days) values($1,$2,$3)', [a,id,days]);
  await q('select submit_application($1)', [a]);
  return a;
};
const row = async id => (await q('select * from holiday_work_records where id=$1', [id]))[0];
const visible = id => q('select * from get_comp_leave_availability(1) where id=$1', [id]);
const expire = () => q('select * from expire_comp_leave_records_automated()');
const asService = () => db.exec("set local role service_role; select set_config('test.actor','',true)");
const scenario = async (name, run) => {
  await db.exec('begin');
  try { await run(); console.log('PASS: ' + name); }
  finally { await db.exec('rollback'); }
};
const denied = async (run, message = 'permission denied') => {
  await db.exec('savepoint denied');
  await assert.rejects(run, error => error.message.includes(message));
  await db.exec('rollback to savepoint denied');
};
await db.exec(clock(await read('supabase/add_admin_comp_leave_usage_edit.sql')));
await db.exec(clock(await read('supabase/add_admin_comp_leave_usage_edit.sql')));
const register = async (days=1) => (await q("select register_admin_comp_leave_usage(1,'2026-09-17',$1,gen_random_uuid(),'original') id",[days]))[0].id;
const update = (id,days=.5,date='2026-09-18',employee=1) => q('select update_admin_comp_leave_usage($1,$2,$3,$4,$5)',[id,employee,date,days,'changed']);
const remove = (id,employee=1) => q('select delete_admin_comp_leave_usage($1,$2)',[id,employee]);
const application = async id => (await q('select * from applications where id=$1',[id]))[0];
const allocations = id => q('select holiday_work_record_id,allocated_days from comp_leave_allocations where application_id=$1 order by holiday_work_record_id',[id]);
await scenario('edit date/days/note, immutable registration, FIFO, audit, logical delete and duplicate refusal',async()=>{
  const older=await work('2026-01-01',1), newer=await work('2026-02-01',2);
  const id=await register(1.5), before=await application(id);
  await update(id,.5);
  const after=await application(id);
  for(const key of ['employee_id','created_by_employee_id','created_at','approved_at','reviewer_comment'])assert.deepEqual(after[key],before[key]);
  assert.equal(after.applicant_note,'changed');
  const dates=await q('select leave_date::text,days from comp_leave_dates where application_id=$1',[id]);
  assert.equal(dates[0].leave_date,'2026-09-18');assert.equal(Number(dates[0].days),.5);
  assert.equal((await allocations(id))[0].holiday_work_record_id,older);
  assert.equal(Number((await row(older)).remaining_days),.5);
  assert.equal(Number((await row(newer)).remaining_days),2);
  await update(id,1.25);assert.equal((await allocations(id)).length,2);
  await update(id,.01);assert.equal(Number((await allocations(id))[0].allocated_days),.01);
  await remove(id);assert.equal((await application(id)).status,'cancelled');
  assert.equal((await allocations(id)).length,0);
  assert.equal(Number((await row(older)).remaining_days),1);
  assert.equal(Number((await row(newer)).remaining_days),2);
  await denied(()=>remove(id),'有効な管理者');await denied(()=>update(id),'有効な管理者');
  const history=await q('select * from application_status_history where application_id=$1 order by id',[id]);
  assert.equal(history.length,5);assert.match(history[1].comment,/修正/);assert.match(history[4].comment,/削除/);
  assert.ok(history.every(r=>r.changed_by_employee_id===1 && r.changed_at));
});
await scenario('submitted/revision reservations protected and failed edit rolls back all changes',async()=>{
  const source=await work('2026-01-01',3),id=await register();
  const pending=await app(source,1,'2026-09-30');
  const before=await allocations(id);
  await denied(()=>update(id,2.01),'使用可能');assert.deepEqual(await allocations(id),before);
  assert.equal((await application(id)).applicant_note,'original');
  await update(id,2);assert.equal(Number((await row(source)).remaining_days),1);
  const reserved=await allocations(pending);
  await remove(id);assert.deepEqual(await allocations(pending),reserved);
  assert.equal(Number((await visible(source))[0].available_days),2);
  await q("update applications set status='revision_required' where id=$1",[pending]);
  const other=await register();await denied(()=>update(other,2.01),'使用可能');
  await update(other,2);assert.deepEqual(await allocations(pending),reserved);
});
await scenario('expired, cancelled, exhausted and usage-date-ineligible sources excluded',async()=>{
  const expired=await work('2025-01-01',2),valid=await work('2026-01-01',2);
  const cancelled=await work('2026-02-01',5);
  await q("update holiday_work_records set status='cancelled' where id=$1",[cancelled]);
  const id=await register(); // legacy registration permits a past usage date only within expiry
  await update(id,1);assert.equal((await allocations(id))[0].holiday_work_record_id,valid);
  assert.equal(Number((await row(expired)).used_days),0);
  await denied(()=>update(id,1,'2027-02-01'),'使用可能');
  await denied(()=>update(id,2.01),'使用可能');
});
await scenario('old used source expires: released balance stays unavailable for new use',async()=>{
  const old=await work('2025-09-20',1);
  const id=await register();
  await denied(()=>update(id,.5),'使用可能');
  await remove(id);assert.equal(Number((await row(old)).remaining_days),1);
  assert.equal((await visible(old)).length,0);
});
await scenario('normal application, mismatched employee, invalid units rejected',async()=>{
  const source=await work('2026-01-01',10),normal=await app(source,1,'2026-09-30');
  await q("update applications set status='approved',approved_at=now(),approved_by_employee_id=1 where id=$1",[normal]);
  await denied(()=>update(normal),'有効な管理者');await denied(()=>remove(normal),'有効な管理者');
  const id=await register();
  await denied(()=>update(id,1,'2026-09-30',2),'有効な管理者');
  await denied(()=>remove(id,2),'有効な管理者');
  for(const days of [0,-1,.001,10000,'NaN','Infinity'])await denied(()=>update(id,days),'小数2桁');
});
await scenario('authenticated ordinary employee/admin without leave manager and anonymous denied',async()=>{
  await work('2026-01-01',2);const id=await register();
  // Broad application-admin permission must not substitute for leave-manager permission.
  await db.exec('create or replace function is_application_admin() returns boolean language sql stable as $$ select true $$');
  await db.exec("set local role authenticated; select set_config('test.actor','2',true)");
  await denied(()=>update(id),'残数管理権限');await denied(()=>remove(id),'残数管理権限');
  await denied(()=>q('select modify_admin_comp_leave_usage_internal($1,1,true,null,null,null)',[id]));
  await db.exec("reset role; select set_config('test.actor','',true); set local role authenticated");
  await denied(()=>remove(id),'残数管理権限');
  await db.exec('reset role; set local role anon');await denied(()=>remove(id));await denied(()=>update(id));
});
await db.close();
