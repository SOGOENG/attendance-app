// PGLITE_MODULE=/path/to/pglite/dist/index.js node tests/admin-paid-usage-request-identity-db.test.mjs
// Isolated PostgreSQL only; never connects to production.
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
const {PGlite}=await import(process.env.PGLITE_MODULE ? pathToFileURL(process.env.PGLITE_MODULE).href : '@electric-sql/pglite');
const read=async f=>(await readFile(new URL(`../${f}`,import.meta.url),'utf8')).replaceAll('\r','');
const base=await read('supabase/application_management.sql');
const fn=name=>{const start=base.indexOf(`create or replace function public.${name}(`);return base.slice(start,base.indexOf('$$;',base.indexOf('as $$',start))+3);};
const db=new PGlite();
const q=async(sql,args=[])=>(await db.query(sql,args)).rows;
await db.exec(`create role anon; create role authenticated;
create table employees(id bigint primary key,active boolean,is_leave_manager boolean);
create table sites(id bigint primary key); create table attendance(id bigint primary key);
insert into employees values(1,true,true),(2,true,false),(3,false,true);
create function current_employee_id() returns bigint language sql stable as
$$ select nullif(current_setting('test.actor',true),'')::bigint $$;
create function is_leave_manager() returns boolean language sql stable security definer as
$$ select exists(select 1 from public.employees where id=public.current_employee_id() and active and is_leave_manager) $$;
select set_config('test.actor','1',false);`);
await db.exec(base.slice(base.indexOf('create table if not exists public.application_types'),base.indexOf('-- 申請から反映した出勤簿行')));
await db.exec(fn('recalculate_paid_leave_balance'));
await db.exec(await read('supabase/add_admin_paid_leave_usage.sql'));
const migration=await read('supabase/add_admin_paid_leave_usage_edit.sql');
await db.exec(migration);await db.exec(migration);
await db.exec(`insert into paid_leave_balances(employee_id,fiscal_year,created_by_employee_id) values(1,2026,1),(1,2027,1);
insert into paid_leave_balance_transactions(balance_id,transaction_type,days,source_key,created_by_employee_id)
select id,'grant',20,'grant',1 from paid_leave_balances;
select recalculate_paid_leave_balance(id) from paid_leave_balances;`);
const fix=await read('supabase/fix_admin_paid_leave_usage_request_identity.sql');
const uuid=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
const register=(request,date='2026-10-01',days=1,note='original',employee=1)=>q(
  'select (register_admin_paid_leave_usage($1,$2,$3,$4,$5)).fiscal_year as year',[employee,date,days,request,note]);
const find=async request=>(await q("select * from paid_leave_balance_transactions where source_key like 'admin_paid_usage:%' and split_part(source_key,':',3)=$1",[request]))[0];
const edit=(id,date,days=.5)=>q('select update_admin_paid_leave_usage($1,1,$2,$3,$4)',[id,date,days,'edited']);
const remove=id=>q('select delete_admin_paid_leave_usage($1,1)',[id]);
const snapshot=async()=>({balances:await q('select * from paid_leave_balances order by id'),transactions:await q('select * from paid_leave_balance_transactions order by id')});
// Existing keys and all edit/delete states must migrate without rewriting history.
for(const n of [1,2,3,4])await register(uuid(n));
const legacyDate=(await find(uuid(1))).id,legacyYear=(await find(uuid(2))).id,legacyDeleted=(await find(uuid(3))).id;
await edit(legacyDate,'2026-10-02');await edit(legacyYear,'2027-04-01');await remove(legacyDeleted);
const beforeMigration=await snapshot();
// Stop rather than automatically deduplicate data that has already been double-consumed.
const duplicate=(await q(`insert into paid_leave_balance_transactions(balance_id,transaction_type,days,source_key)
  values(1,'application_usage',-1,$1) returning id`,[`admin_paid_usage:2026-10-09:${uuid(1)}`]))[0].id;
await assert.rejects(()=>db.exec(fix),/admin_paid_usage_duplicate_request_identity/);await db.exec('rollback');
assert.equal((await q("select to_regclass('admin_paid_usage_request_uidx') id"))[0].id,null);
await q('delete from paid_leave_balance_transactions where id=$1',[duplicate]);
const malformed=(await q("insert into paid_leave_balance_transactions(balance_id,transaction_type,days,source_key) values(1,'application_usage',-1,'admin_paid_usage:2026-10-01:invalid') returning id"))[0].id;
await assert.rejects(()=>db.exec(fix),/admin_paid_usage_invalid_request_identity/);await db.exec('rollback');
await q('delete from paid_leave_balance_transactions where id=$1',[malformed]);
await db.exec(fix);await db.exec(fix);
assert.deepEqual(await snapshot(),beforeMigration);
console.log('PASS: untouched legacy data/audit, repeated migration, duplicates/malformed keys block migration atomically');
for(const [n,expectedYear] of [[1,2026],[2,2027],[3,2026],[4,2026]]){
  const before=await snapshot();
  assert.equal((await register(uuid(n)))[0].year,expectedYear);
  assert.deepEqual(await snapshot(),before);
}
// Same UUID never represents an edit, including altered valid payloads.
const beforeChangedReplay=await snapshot();
await register(uuid(1),'2028-10-01',999,'different'); // replay target year need not exist
assert.deepEqual(await snapshot(),beforeChangedReplay);
console.log('PASS: legacy date/year/deleted/original replay and changed payload are no-ops');

const fresh=uuid(10);await register(fresh);
const freshId=(await find(fresh)).id;
const replay=async expectedYear=>{
  const before=await snapshot();
  assert.equal((await register(fresh))[0].year,expectedYear);
  assert.deepEqual(await snapshot(),before);
  assert.equal((await q("select count(*)::int n from paid_leave_balance_transactions where transaction_type='application_usage' and application_id is null and split_part(source_key,':',3)=$1",[fresh]))[0].n,1);
};
await replay(2026);
await edit(freshId,'2026-10-03',.5);await replay(2026);
assert.equal(Number((await find(fresh)).days),-.5);
await edit(freshId,'2026-10-03',1);await replay(2026);
await edit(freshId,'2027-04-02',.5);await replay(2027);
assert.equal((await find(fresh)).id,freshId);
const beforeOverdraft=await snapshot();
await assert.rejects(()=>edit(freshId,'2027-04-02',999),/insufficient_paid_leave_balance/);
assert.deepEqual(await snapshot(),beforeOverdraft);
const remaining=async year=>Number((await q('select remaining_days from paid_leave_balances where fiscal_year=$1',[year]))[0].remaining_days);
const remainingBeforeDelete=await remaining(2027);
await remove(freshId);assert.equal(await remaining(2027),remainingBeforeDelete+.5);
assert.equal((await find(fresh)).active,false);await replay(2027);
await assert.rejects(()=>remove(freshId),/有効な管理者/);
await assert.rejects(()=>edit(freshId,'2026-10-01'),/有効な管理者/);
const audits=await q("select * from paid_leave_balance_transactions where source_key like $1 order by id",[`admin_paid_usage_audit:${freshId}:%`]);
assert.equal(audits.length,4);assert.equal(JSON.parse(audits.at(-1).reason).operation,'delete');
assert.ok(audits.every(r=>!r.active && Number(r.days)===0 && r.created_by_employee_id===1));
console.log('PASS: new same-day/date/days/year/deleted replay, overdraft rollback, restoration and audit preserved');

// Unique index must include tombstones, years and all employees.
await assert.rejects(()=>q(`insert into paid_leave_balance_transactions(balance_id,transaction_type,days,source_key)
  values(1,'application_usage',-1,$1)`,[`admin_paid_usage:2026-10-29:${fresh}`]),error=>error.code==='23505');
await assert.rejects(()=>register(fresh,'2026-10-01',1,'original',2),/別の対象社員/);
// Normal application transactions and audit rows are outside the request index.
const normal=(await q("insert into applications(application_type,employee_id,created_by_employee_id) values('paid_leave',1,1) returning id"))[0].id;
const normalTx=(await q("insert into paid_leave_balance_transactions(balance_id,application_id,transaction_type,days,source_key) values(1,$1,'application_usage',-1,$2) returning id",[normal,`admin_paid_usage:2026-10-01:${fresh}`]))[0].id;
await assert.rejects(()=>edit(normalTx,'2026-10-03'),/有効な管理者/);
await assert.rejects(()=>remove(normalTx),/有効な管理者/);
const beforePermissions=await snapshot();
await db.exec("set role authenticated;select set_config('test.actor','2',false)");
await assert.rejects(()=>register(fresh),/残数管理権限/);
await q("select set_config('test.actor','1',false)");
assert.equal((await register(fresh))[0].year,2027);
await db.exec('reset role;set role anon');await assert.rejects(()=>register(fresh),/permission denied/);await db.exec('reset role');
assert.deepEqual(await snapshot(),beforePermissions);
console.log('PASS: global UUID/tombstone uniqueness, employee mismatch, normal application isolation, manager/anonymous permissions');
await db.close();
