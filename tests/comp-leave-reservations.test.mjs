// Run: PGLITE_MODULE=/absolute/path/to/@electric-sql/pglite/dist/index.js node tests/comp-leave-reservations.test.mjs
// Uses an isolated in-memory PostgreSQL engine; never connects to Supabase.
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
const { PGlite } = await import(process.env.PGLITE_MODULE
  ? pathToFileURL(process.env.PGLITE_MODULE).href : '@electric-sql/pglite');
const read = name => readFile(new URL(`../${name}`, import.meta.url), 'utf8');
const base = await read('supabase/application_management.sql');
const delta = await read('supabase/fix_comp_leave_reservations.sql');
const direct = await read('supabase/add_admin_comp_leave_usage.sql');
const shared = await read('supabase/comp_leave_availability_functions.sql');
const fn = (source, name) => {
  const start = source.indexOf(`create or replace function public.${name}(`);
  assert.ok(start >= 0, name);
  return source.slice(start, source.indexOf('$$;', source.indexOf('as $$', start)) + 3);
};
for (const name of ['submit_application','comp_leave_availability_internal','get_comp_leave_availability']) {
  assert.equal(fn(base,name).replaceAll('\r',''), fn(delta,name).replaceAll('\r',''));
}
assert.equal(fn(direct,'register_admin_comp_leave_usage'), fn(delta,'register_admin_comp_leave_usage'));
assert.ok(delta.includes(shared));
const db = new PGlite();
await db.exec(`
  create role anon; create role authenticated;
  create table employees(id bigint primary key,active boolean default true);
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
  select set_config('test.actor','1',false);
`);
// Use actual repository tables, constraints and business functions. Auth is stubbed above.
await db.exec(base.slice(base.indexOf('create table if not exists public.application_types'),
  base.indexOf('-- 申請から反映した出勤簿行')));
for (const name of ['recalculate_holiday_work_record','review_application','cancel_application',
  'update_holiday_work','cancel_holiday_work','set_application_actor']) await db.exec(fn(base,name));
await db.exec(`create trigger applications_actor before insert or update on applications
  for each row execute function set_application_actor();
  alter table comp_leave_dates drop constraint comp_leave_dates_days_check;`);
await db.exec(direct);
await db.exec(delta);
await db.exec(delta); // Upgrade is repeatable; no duplicate CHECK/trigger/column changes.
const q = async (sql, params=[]) => (await db.query(sql,params)).rows;
const balance = async id => (await q('select * from get_comp_leave_availability(1) where id=$1',[id]))[0];
const work = async (days=1,date='2026-07-01',employee=1) => (await q(`insert into holiday_work_records
  (employee_id,work_date,earned_days,remaining_days,created_by_employee_id)
  values($1,$2,$3,$3,1) returning id`,[employee,date,days]))[0].id;
const app = async (record,days=1,status='draft') => {
  const id=(await q(`insert into applications(application_type,employee_id,created_by_employee_id)
    values('comp_leave',1,1) returning id`))[0].id;
  await q('insert into comp_leave_application_details(application_id) values($1)',[id]);
  await q("insert into comp_leave_dates(application_id,leave_date,days) values($1,'2026-08-01',$2)",[id,days]);
  await q('insert into comp_leave_allocations(application_id,holiday_work_record_id,allocated_days) values($1,$2,$3)',[id,record,days]);
  if(status==='submitted') await q('select submit_application($1)',[id]);
  else if(status!=='draft') await q(`update applications set status=$2,
    approved_at=case when $2='approved' then now() end,
    approved_by_employee_id=case when $2='approved' then 1 end,
    rejected_at=case when $2='rejected' then now() end,
    rejected_by_employee_id=case when $2='rejected' then 1 end where id=$1`,[id,status]);
  if(status==='approved') await q('select recalculate_holiday_work_record($1)',[record]);
  return id;
};
const usage = async days => (await q("select register_admin_comp_leave_usage(1,'2026-08-02',$1,gen_random_uuid()) as id",[days]))[0].id;
const fails = async (run,message) => assert.rejects(run,e=>e.message.includes(message));
const scenario = async (name,run) => {
  await db.exec('begin');
  try { await run(); console.log(`PASS: ${name}`); }
  finally { await db.exec('rollback'); }
};
// Expected errors inside a scenario must not abort its enclosing transaction.
const rejected = async (run,message) => {
  await db.exec('savepoint expected_error');
  await fails(run,message);
  await db.exec('rollback to savepoint expected_error');
};
await scenario('submitted 1 day blocks direct usage; remains approvable',async()=>{
  const h=await work(), a=await app(h,1,'submitted');
  assert.equal(Number((await balance(h)).available_days),0);
  await rejected(()=>usage(1),'現在の代休残日数を超えています');
  await q("select review_application($1,'approved')",[a]);
  assert.equal(Number((await balance(h)).remaining_days),0);
});
await scenario('half-day reservation leaves half-day for direct usage and normal approval',async()=>{
  const h=await work(), a=await app(h,.5,'submitted');
  await usage(.5);
  const b=await balance(h);
  assert.equal(Number(b.remaining_days),.5);
  assert.equal(Number(b.reserved_days),.5);
  assert.equal(Number(b.available_days),0);
  await q("select review_application($1,'approved')",[a]);
});
await scenario('approved allocation is deducted exactly once',async()=>{
  const h=await work(); await app(h,.5,'approved');
  assert.equal(Number((await balance(h)).available_days),.5);
  await usage(.5);
});
await scenario('normal application B cannot submit A reservation; B remains draft',async()=>{
  const h=await work(); await app(h,1,'submitted'); const b=await app(h);
  await rejected(()=>q('select submit_application($1)',[b]),'insufficient_comp_leave_balance');
  assert.equal((await q('select status from applications where id=$1',[b]))[0].status,'draft');
});
for(const status of ['draft','rejected','cancelled','revision_required']) {
  await scenario(`${status} is not reserved`,async()=>{
    const h=await work(); await app(h,1,status);
    assert.equal(Number((await balance(h)).reserved_days),0);
    await usage(1);
  });
}
for(const status of ['rejected','revision_required','cancelled']) {
  await scenario(`reservation becomes available after ${status}`,async()=>{
    const h=await work(),a=await app(h,1,'submitted');
    if(status==='cancelled') await q('select cancel_application($1)',[a]);
    else await q('select review_application($1,$2)',[a,status]);
    assert.equal(Number((await balance(h)).available_days),1);
    await usage(1);
  });
}
await scenario('FIFO skips full reservations and consumes only unreserved portion',async()=>{
  const third=await work(1,'2026-07-03'),first=await work(1,'2026-07-01'),second=await work(1,'2026-07-02');
  await app(first,1,'submitted'); await app(second,.5,'submitted');
  const id=await usage(1);
  const rows=await q('select holiday_work_record_id,allocated_days from comp_leave_allocations where application_id=$1',[id]);
  assert.deepEqual(new Map(rows.map(r=>[r.holiday_work_record_id,Number(r.allocated_days)])),new Map([[second,.5],[third,.5]]));
});
await scenario('own allocation exclusion, inactive/foreign records and stale remaining',async()=>{
  const h=await work(),a=await app(h,1,'submitted');
  assert.equal(Number((await q('select available_days from comp_leave_availability_internal(1,$1) where id=$2',[a,h]))[0].available_days),1);
  const foreign=await work(1,'2026-07-02',2),b=await app(foreign);
  await rejected(()=>q('select submit_application($1)',[b]),'invalid_or_cancelled_holiday_work_record');
  const cancelled=await work(),c=await app(cancelled);
  await q("select cancel_holiday_work($1,'test')",[cancelled]);
  await rejected(()=>q('select submit_application($1)',[c]),'invalid_or_cancelled_holiday_work_record');
  const spent=await work();await app(spent,1,'approved');const d=await app(spent);
  await rejected(()=>q('select submit_application($1)',[d]),'insufficient_comp_leave_balance');
});
await scenario('reservation protects holiday-work correction/cancellation',async()=>{
  const h=await work();await app(h,1,'submitted');
  await rejected(()=>q("select update_holiday_work($1,'2026-07-01',0.5)",[h]),'earned_days_cannot_be_less');
  await rejected(()=>q('select cancel_holiday_work($1)',[h]),'holiday_work_allocated');
});
await scenario('RPC permissions and private internal function',async()=>{
  await db.exec("set local role authenticated; select set_config('test.actor','2',true)");
  await q('select * from get_comp_leave_availability(2)');
  await rejected(()=>q('select * from get_comp_leave_availability(1)'),'forbidden');
  await rejected(()=>q('select * from comp_leave_availability_internal(2)'),'permission denied');
});
await db.close();
console.log('PASS: migration repeatability and baseline/upgrade parity. Multi-connection concurrency requires PostgreSQL integration testing.');
