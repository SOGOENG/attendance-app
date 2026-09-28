// PGLITE_MODULE=/path/to/pglite/dist/index.js node tests/comp-leave-expiration-automation.test.mjs
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
await scenario('anniversary included; next JST midnight excluded even with UTC session', async () => {
  const id = await work();
  await db.exec("set timezone='UTC'; select set_config('test.now','2026-09-15T14:59:59Z',true)");
  assert.equal((await visible(id)).length, 1);
  assert.equal((await q('select * from expire_comp_leave_records()')).length, 0);
  await db.exec("select set_config('test.now','2026-09-15T15:00:00Z',true)");
  assert.equal((await visible(id)).length, 0);
  assert.equal(Number((await row(id)).remaining_days), 1); // visibility does not mutate
  assert.equal((await q('select * from comp_leave_availability_internal(1)')).length, 1);
});
await scenario('initial cleanup both example dates, ledger consistency and idempotence', async () => {
  const ids = [await work(), await work('2025-09-23')];
  await asService();
  assert.equal((await expire()).length, 2);
  assert.equal((await expire()).length, 0);
  await db.exec('reset role');
  for (const id of ids) {
    const h = await row(id);
    assert.equal(Number(h.remaining_days), 0);
    assert.equal(Number(h.expired_days), 1);
    assert.equal(h.updated_by_employee_id, null);
    const ledger = await q('select * from comp_leave_expirations where holiday_work_record_id=$1', [id]);
    assert.equal(ledger.length, 1);
    assert.equal(Number(ledger[0].expired_days), 1);
    assert.equal(Number(h.earned_days), Number(h.used_days)+Number(h.expired_days)+Number(h.remaining_days));
  }
});
await scenario('valid submitted reservation protected and can still be approved', async () => {
  const id = await work('2025-09-15', 2);
  const a = await app(id, 1, '2026-09-15');
  await asService();
  const result = await expire();
  assert.equal(Number(result[0].newly_expired_days), 1);
  assert.equal(Number(result[0].protected_reserved_days), 1);
  await db.exec("reset role; select set_config('test.actor','1',true)");
  assert.equal(Number((await row(id)).remaining_days), 1);
  assert.equal((await visible(id)).length, 0);
  await q("select review_application($1,'approved')", [a]);
  assert.equal(Number((await row(id)).used_days), 1);
  assert.equal(Number((await row(id)).remaining_days), 0);
  assert.equal(Number((await row(id)).expired_days), 1);
});
await scenario('released reservation expires on next run, without negative balance', async () => {
  const id = await work();
  const a = await app(id, 1, '2026-09-15');
  assert.equal((await expire()).length, 0);
  await q("select review_application($1,'revision_required')", [a]);
  await asService();
  assert.equal((await expire()).length, 1);
  assert.equal((await expire()).length, 0);
  await db.exec('reset role');
  assert.equal(Number((await row(id)).remaining_days), 0);
});
await scenario('cancelled excluded, normal in-term leave displayed and submitted', async () => {
  const cancelled = await work('2026-09-01');
  await q('select cancel_holiday_work($1)', [cancelled]);
  assert.equal((await visible(cancelled)).length, 0);
  const id = await work('2026-09-01');
  assert.equal((await visible(id)).length, 1);
  await app(id, 1, '2026-10-01');
  assert.equal(Number((await visible(id))[0].available_days), 0);
  await asService();
  assert.equal((await expire()).length, 0);
});
await scenario('RPC ACLs and unchanged manual manager guard', async () => {
  await work();
  for (const role of ['anon','authenticated','service_role']) {
    await db.exec(`set local role ${role}`);
    await denied(() => q('select * from expire_comp_leave_records_internal()'));
    if (role !== 'service_role') await denied(expire);
    await db.exec('reset role');
  }
  await db.exec("set local role authenticated; select set_config('test.actor','2',true)");
  await denied(() => q('select * from expire_comp_leave_records()'), 'leave_manager_required');
  await db.exec("select set_config('test.actor','1',true)");
  assert.equal((await q('select * from expire_comp_leave_records()')).length, 1);
});
await db.close();
console.log('PASS: definition parity and repeatable migrations');
