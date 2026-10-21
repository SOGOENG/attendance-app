// PGLITE_MODULE=/path/to/pglite/dist/index.js node tests/comp-leave-date-allocations-db.test.mjs
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
await db.exec(await read('supabase/add_admin_comp_leave_usage_edit.sql'));
for (const name of ['reopen_application_draft']) await db.exec(fn(base,name));
await db.exec(await read('supabase/add_delete_draft_application.sql'));
const dailyMigration = await read('supabase/add_comp_leave_date_allocations.sql');
const work=async(date,days=1,employee=1)=>(await q(`insert into holiday_work_records
  (employee_id,work_date,earned_days,remaining_days,created_by_employee_id)
  values($1,$2,$3,$3,1) returning id`,[employee,date,days]))[0].id;
const draft=async(dates,sources)=>{
  const id=(await q("insert into applications(application_type,employee_id,created_by_employee_id) values('comp_leave',1,1) returning id"))[0].id;
  await q('insert into comp_leave_application_details(application_id) values($1)',[id]);
  for(const [index,[date,days]] of dates.entries())await q('insert into comp_leave_dates(application_id,leave_date,days,display_order) values($1,$2,$3,$4)',[id,date,days,index]);
  for(const [source,days] of sources)await q('insert into comp_leave_allocations(application_id,holiday_work_record_id,allocated_days) values($1,$2,$3)',[id,source,days]);
  return id;
};
const submit=id=>q('select submit_application($1)',[id]);
const approve=id=>q("select review_application($1,'approved',null)",[id]);
const mappings=id=>q(`select d.leave_date::text,h.work_date::text,da.allocated_days,da.created_at,
  da.comp_leave_date_id,da.comp_leave_allocation_id from comp_leave_date_allocations da
  join comp_leave_dates d on d.id=da.comp_leave_date_id
  join holiday_work_records h on h.id=da.holiday_work_record_id
  where da.application_id=$1 order by d.leave_date,h.work_date`,[id]);
const remaining=async id=>Number((await q('select remaining_days from holiday_work_records where id=$1',[id]))[0].remaining_days);
const oldSource1=await work('2026-02-01'),oldSource2=await work('2026-02-02');
const legacy=await draft([['2026-09-20',1],['2026-09-21',1]],[[oldSource2,1],[oldSource1,1]]);
await submit(legacy);
const legacyDirectSource=await work('2026-01-10',2);
const legacyDirect=(await q("select register_admin_comp_leave_usage(1,'2026-09-20',.5,gen_random_uuid(),'legacy direct') id"))[0].id;
await db.exec(dailyMigration);await db.exec(dailyMigration);
// Observe DELETE on the real source tables with the migration's BEFORE trigger
// enabled. Exercise NEW IS NULL, NEW.field and the exact COALESCE expression.
await db.exec(`create table test_delete_trigger_observations(
  table_name text, new_is_null boolean, new_app bigint, old_app bigint,
  selected_app bigint, new_direct boolean, old_direct boolean);
create function test_observe_delete_trigger() returns trigger language plpgsql as $$
declare v_new_direct boolean; v_old_direct boolean;
begin
  if tg_table_name='comp_leave_dates' then
    v_new_direct:=new.admin_direct;v_old_direct:=old.admin_direct;
  end if;
  insert into public.test_delete_trigger_observations values(
    tg_table_name,new is null,new.application_id,old.application_id,
    coalesce(new.application_id,old.application_id),v_new_direct,v_old_direct);
  return old;
end;$$;
create trigger zz_test_observe_delete before delete on comp_leave_dates
  for each row execute function test_observe_delete_trigger();
create trigger zz_test_observe_delete before delete on comp_leave_allocations
  for each row execute function test_observe_delete_trigger();`);
assert.equal((await mappings(legacy)).length,0);
await approve(legacy);assert.equal((await mappings(legacy)).length,0);
assert.equal((await mappings(legacyDirect)).length,0);
await q("update comp_leave_application_details set note='metadata only' where application_id=$1",[legacyDirect]);
await q('update applications set printed_at=now() where id=$1',[legacyDirect]);
assert.equal((await mappings(legacyDirect)).length,0);
await q("update comp_leave_application_details set note='legacy direct' where application_id=$1",[legacyDirect]);
console.log('PASS: repeat migration and legacy submission/approval never backfilled');
const guardedDirect=(await q("select register_admin_comp_leave_usage(1,'2026-09-20',.5,gen_random_uuid(),'new direct') id"))[0].id;

// Simulate audit omission and changed audit conditions without replacing RPC logic.
// The independent guard must mark both new registrations and legacy edits required.
const snapshot=async()=>({
  apps:await q('select * from applications order by id'),
  dates:await q('select * from comp_leave_dates order by id'),
  allocations:await q('select * from comp_leave_allocations order by id'),
  daily:await q('select * from comp_leave_date_allocations order by id'),
  details:await q('select * from comp_leave_application_details order by application_id'),
  work:await q('select * from holiday_work_records order by id'),
  history:await q('select * from application_status_history order by id')
});
for(const mode of ['omit','change']){
  await db.exec(`create or replace function test_mutate_audit() returns trigger language plpgsql as $$begin
    ${mode==='omit' ? 'return null;' : "new.from_status:='submitted'; return new;"}
  end$$;
  create trigger test_mutate_audit before insert on application_status_history for each row execute function test_mutate_audit();`);
  const before=await snapshot();
  await assert.rejects(()=>q("select register_admin_comp_leave_usage(1,'2026-09-21',.5,gen_random_uuid(),'no mapping')"),/comp_leave_date_allocation_mismatch/);
  assert.deepEqual(await snapshot(),before);
  await assert.rejects(()=>q("select update_admin_comp_leave_usage($1,1,'2026-09-22',1,'no mapping')",[legacyDirect]),/comp_leave_date_allocation_mismatch/);
  assert.deepEqual(await snapshot(),before);
  await assert.rejects(()=>q("select update_admin_comp_leave_usage($1,1,'2026-09-22',1,'no mapping')",[guardedDirect]),/comp_leave_date_allocation_mismatch/);
  assert.deepEqual(await snapshot(),before);
  await db.exec('drop trigger test_mutate_audit on application_status_history');
}
// Removing the entire AFTER audit hook must also fail closed.
await db.exec('alter table application_status_history disable trigger comp_leave_date_allocations_admin_history');
await assert.rejects(()=>q("select register_admin_comp_leave_usage(1,'2026-09-21',.5,gen_random_uuid(),'hook disabled')"),/comp_leave_date_allocation_mismatch/);
await assert.rejects(()=>q("select update_admin_comp_leave_usage($1,1,'2026-09-22',1,'hook disabled')",[guardedDirect]),/comp_leave_date_allocation_mismatch/);
// Delete must succeed without a rebuild hook; cancellation clears the requirement.
await q('select delete_admin_comp_leave_usage($1,1)',[guardedDirect]);
assert.equal((await mappings(guardedDirect)).length,0);
await db.exec('alter table application_status_history enable trigger comp_leave_date_allocations_admin_history');
assert.equal((await mappings(legacyDirect)).length,0);
await q("select update_admin_comp_leave_usage($1,1,'2026-09-22',.5,'real edit')",[legacyDirect]);
assert.equal((await mappings(legacyDirect)).length,1);
await q('select delete_admin_comp_leave_usage($1,1)',[legacyDirect]);
console.log('PASS: omitted/changed/disabled audit hook rejects registration and legacy edits atomically, untouched legacy preserved');

const source1=await work('2026-03-01',4),source2=await work('2026-04-01',4);
const one=await draft([['2026-09-21',1]],[[source1,1]]);
await submit(one);assert.equal((await mappings(one)).length,1);
assert.equal(await remaining(source1),4); // submission reserves, does not consume
await approve(one);assert.equal(await remaining(source1),3);
assert.equal(Number((await mappings(one))[0].allocated_days),1);
console.log('PASS: single day, submission reservation, approval consumption unchanged');

// Inputs are deliberately reversed: new mapping policy is dates ascending, selected sources FIFO.
const many=await draft([['2026-09-23',1],['2026-09-22',1]],[[source2,1],[source1,1]]);
await submit(many);
const pairs=await mappings(many);
assert.deepEqual(pairs.map(r=>[r.leave_date,r.work_date,Number(r.allocated_days)]),[
  ['2026-09-22','2026-03-01',1],['2026-09-23','2026-04-01',1]]);
assert.ok(pairs.every(r=>r.created_at));await approve(many);
assert.equal(await remaining(source1),2);assert.equal(await remaining(source2),3);
console.log('PASS: multiple usage days/sources, recorded FIFO mapping and creation timestamp');

const split=await draft([['2026-09-24',1]],[[source2,.5],[source1,.5]]);
await submit(split);assert.equal((await mappings(split)).length,2);
assert.ok((await mappings(split)).every(r=>Number(r.allocated_days)===.5));
await q("select review_application($1,'revision_required','change')",[split]);
assert.equal((await mappings(split)).length,0);
await q('select reopen_application_draft($1)',[split]);
await q('delete from comp_leave_allocations where application_id=$1',[split]);
await q('delete from comp_leave_dates where application_id=$1',[split]);
await q("insert into comp_leave_dates(application_id,leave_date,days) values($1,'2026-09-25',0.5)",[split]);
await q('insert into comp_leave_allocations(application_id,holiday_work_record_id,allocated_days) values($1,$2,.5)',[split,source2]);
await submit(split);await approve(split);
assert.deepEqual((await mappings(split)).map(r=>[r.leave_date,r.work_date,Number(r.allocated_days)]),[['2026-09-25','2026-04-01',.5]]);
await q("select cancel_application($1,'cancel')",[split]);assert.equal((await mappings(split)).length,0);
assert.equal(await remaining(source2),3);
console.log('PASS: split/half day, revision, reopen, source replacement, resubmission, reapproval, cancellation');

const rejected=await draft([['2026-09-26',.5]],[[source1,.5]]);await submit(rejected);
await q("select review_application($1,'rejected','no')",[rejected]);assert.equal((await mappings(rejected)).length,0);
const deleted=await draft([['2026-09-26',.5]],[[source1,.5]]);await submit(deleted);
await q("select review_application($1,'revision_required','edit')",[deleted]);await q('select reopen_application_draft($1)',[deleted]);
await q('select delete_draft_application($1)',[deleted]);assert.equal((await mappings(deleted)).length,0);
console.log('PASS: rejection and draft deletion cascade');

const direct=(await q("select register_admin_comp_leave_usage(1,'2026-09-26',1,gen_random_uuid(),'direct') id"))[0].id;
assert.ok((await mappings(direct)).length>0);
await q("select update_admin_comp_leave_usage($1,1,'2026-09-27',.5,'edited')",[direct]);
assert.equal((await mappings(direct))[0].leave_date,'2026-09-27');
assert.equal(Number((await mappings(direct))[0].allocated_days),.5);
const directBefore=await mappings(direct),balanceBefore=await remaining(source1);
await assert.rejects(()=>q("select update_admin_comp_leave_usage($1,1,'2026-09-27',100,'invalid')",[direct]),/使用可能/);
assert.deepEqual(await mappings(direct),directBefore);assert.equal(await remaining(source1),balanceBefore);
await q('select delete_admin_comp_leave_usage($1,1)',[direct]);assert.equal((await mappings(direct)).length,0);
const directDeletes=await q('select * from test_delete_trigger_observations where old_app=$1',[direct]);
assert.ok(directDeletes.length>=2); // edit removes old allocations; delete removes new ones
assert.ok(directDeletes.every(row=>row.new_is_null && row.new_app===null && row.selected_app===direct));
console.log('PASS: direct registration, edit rebuild, delete synchronization');

// Force a mapping failure *inside* submission; the original transition must roll back.
const failure=await draft([['2026-09-26',.5]],[[source1,.5]]);
await db.exec(`create function test_fail_daily() returns trigger language plpgsql as $$begin raise exception 'injected_daily_failure'; end$$;
create trigger test_fail_daily before insert on comp_leave_date_allocations for each row execute function test_fail_daily();`);
await assert.rejects(()=>submit(failure),/injected_daily_failure/);
assert.equal((await q('select status from applications where id=$1',[failure]))[0].status,'draft');
assert.equal((await mappings(failure)).length,0);
await db.exec('drop trigger test_fail_daily on comp_leave_date_allocations');
await submit(failure);
const dateForFailure=(await mappings(failure))[0].comp_leave_date_id;
const allocationForOther=(await mappings(one))[0].comp_leave_allocation_id;
await assert.rejects(()=>q(`insert into comp_leave_date_allocations
  (application_id,comp_leave_date_id,comp_leave_allocation_id,holiday_work_record_id,allocated_days)
  values($1,$2,$3,$4,.5)`,[failure,dateForFailure,allocationForOther,source1]),error=>error.code==='23503');
await assert.rejects(()=>q('delete from comp_leave_date_allocations where application_id=$1',[failure]),/comp_leave_date_allocation_mismatch/);
assert.equal((await mappings(failure)).length,1);
await assert.rejects(()=>q('update comp_leave_dates set days=1 where application_id=$1',[failure]),/comp_leave_date_allocation_mismatch/);
console.log('PASS: injected failure atomic rollback and deferred completeness checks');
const deleteObservations=await q('select * from test_delete_trigger_observations');
assert.ok(deleteObservations.some(row=>row.table_name==='comp_leave_dates'));
assert.ok(deleteObservations.some(row=>row.table_name==='comp_leave_allocations'));
assert.ok(deleteObservations.every(row=>row.new_is_null && row.new_app===null && row.old_app!==null && row.selected_app===row.old_app));
assert.ok(deleteObservations.filter(row=>row.table_name==='comp_leave_dates').every(row=>row.new_direct===null));
console.log('PASS: actual DELETE triggers: NEW is null, NEW fields are null, COALESCE selects OLD; edit/delete/cascade execute with migration guard enabled');

// Fixture permissions for the existing application table emulate its real RLS.
await db.exec(`grant usage on schema public to authenticated;
grant select on applications to authenticated;
grant update(note) on comp_leave_application_details to authenticated;
alter table applications enable row level security;
create policy test_app_read on applications for select to authenticated using
  (employee_id=public.current_employee_id() or public.is_application_admin() or public.is_leave_manager());
create or replace function is_application_admin() returns boolean language sql stable as
  $$select current_setting('test.admin',true)='true'$$;
create or replace function is_leave_manager() returns boolean language sql stable as
  $$select current_setting('test.manager',true)='true'$$;
select set_config('test.manager','false',false);select set_config('test.admin','false',false);
set role authenticated;`);
assert.ok((await q('select * from comp_leave_date_allocations where application_id=$1',[one])).length>0);
for(const sql of ['insert into comp_leave_date_allocations(application_id) values(1)',
  'update comp_leave_date_allocations set allocated_days=0.5','delete from comp_leave_date_allocations',
  'select rebuild_comp_leave_date_allocations_internal(1)',
  'update comp_leave_application_details set date_allocations_recorded=false'])await assert.rejects(()=>q(sql),/permission denied/);
await q("select set_config('test.actor','2',false)");assert.equal((await q('select * from comp_leave_date_allocations')).length,0);
await q("select set_config('test.manager','true',false)");assert.ok((await q('select * from comp_leave_date_allocations where application_id=$1',[one])).length>0);
assert.equal((await q('select * from comp_leave_date_allocations where application_id=$1',[failure])).length,0);
await q("select set_config('test.manager','false',false)");await q("select set_config('test.admin','true',false)");
assert.ok((await q('select * from comp_leave_date_allocations where application_id=$1',[failure])).length>0);
await db.exec('reset role;set role anon');await assert.rejects(()=>q('select * from comp_leave_date_allocations'),/permission denied/);
await db.exec('reset role');
console.log('PASS: owner/admin/approved-only manager reads, unrelated/anonymous rejection, all client writes/internal RPCs denied');
await db.close();
