// PGLITE_MODULE=/path/to/pglite/dist/index.js node tests/admin-paid-usage-edit-db.test.mjs
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
await db.exec(await read('supabase/fix_admin_paid_leave_usage_request_identity.sql'));
await db.exec(`insert into paid_leave_balances(employee_id,fiscal_year,created_by_employee_id) values(1,2026,1),(1,2027,1);
insert into paid_leave_balance_transactions(balance_id,transaction_type,days,source_key,created_by_employee_id)
select id,'grant',2,'grant',1 from paid_leave_balances;
select recalculate_paid_leave_balance(id) from paid_leave_balances;`);
const balance=async year=>Number((await q('select remaining_days from paid_leave_balances where fiscal_year=$1',[year]))[0].remaining_days);
const usage=async id=>(await q('select * from paid_leave_balance_transactions where id=$1',[id]))[0];
await q("select register_admin_paid_leave_usage(1,'2026-10-01',1,gen_random_uuid(),'original')");
const id=(await q("select id from paid_leave_balance_transactions where source_key like 'admin_paid_usage:%'"))[0].id;
const before=await usage(id);
const update=(days,date='2026-10-02',employee=1,tid=id)=>q('select update_admin_paid_leave_usage($1,$2,$3,$4,$5)',[tid,employee,date,days,'changed']);
const remove=(tid=id)=>q('select delete_admin_paid_leave_usage($1,1)',[tid]);
await update(.5);assert.equal(await balance(2026),1.5);
await update(1);assert.equal(await balance(2026),1);
await assert.rejects(()=>update(2.01),/insufficient_paid_leave_balance/);
assert.equal(await balance(2026),1);assert.equal(Number((await usage(id)).days),-1);
await update(.5,'2027-04-01');assert.equal(await balance(2026),2);assert.equal(await balance(2027),1.5);
await update(1);assert.equal(await balance(2027),2);
await db.exec("update paid_leave_balances set base_date='2026-09-30' where fiscal_year=2026");
await assert.rejects(()=>update(.5,'2026-09-30'),/経理取込/);
for(const days of [0,-1,.001,10000,'NaN','Infinity'])await assert.rejects(()=>update(days),/小数2桁/);
await assert.rejects(()=>update(1,'2026-10-02',2),/有効な管理者/);
const after=await usage(id);
for(const key of ['id','created_at','created_by_employee_id','application_id'])assert.deepEqual(after[key],before[key]);
assert.equal(after.reason,'changed');
// A normal approved application's usage must be rejected even with a forged prefix.
const app=(await q("insert into applications(application_type,employee_id,created_by_employee_id,status,approved_at,approved_by_employee_id) values('paid_leave',1,1,'approved',now(),1) returning id"))[0].id;
const normal=(await q("insert into paid_leave_balance_transactions(balance_id,application_id,transaction_type,days,source_key) values(1,$1,'application_usage',-0.5,'admin_paid_usage:2026-10-01:00000000-0000-0000-0000-000000000000') returning id",[app]))[0].id;
await assert.rejects(()=>update(.5,'2026-10-02',1,normal),/有効な管理者/);
await assert.rejects(()=>remove(normal),/有効な管理者/);
await db.exec('set role authenticated');
for(const actor of ['2','3','']){
  await q("select set_config('test.actor',$1,false)",[actor]);
  await assert.rejects(()=>update(.5),/残数管理権限/);await assert.rejects(()=>remove(),/残数管理権限/);
}
await q("select set_config('test.actor','1',false)");
await assert.rejects(()=>q('select modify_admin_paid_leave_usage_internal($1,1,true,null,null,null)',[id]),/permission denied/);
await db.exec('reset role; set role anon');await assert.rejects(()=>remove(),/permission denied/);
await db.exec('reset role');
await remove();assert.equal(await balance(2026),1.5);assert.equal((await usage(id)).active,false);
await assert.rejects(()=>remove(),/有効な管理者/);await assert.rejects(()=>update(.5),/有効な管理者/);
const audits=await q("select * from paid_leave_balance_transactions where source_key like 'admin_paid_usage_audit:%' order by id");
assert.equal(audits.length,5);
assert.ok(audits.every(r=>!r.active && Number(r.days)===0 && r.created_by_employee_id===1 && r.created_at));
assert.equal(JSON.parse(audits.at(-1).reason).operation,'delete');
const history=await q('select * from admin_paid_leave_usage_history(1)');assert.equal(history.length,1);assert.equal(history[0].active,false);
await db.close();
console.log('PASS: fractional edits, overdraft rollback, fiscal transfer, base date, invalid values, immutable creator, normal application protection, permissions, logical/duplicate delete, audit, repeat migration');
