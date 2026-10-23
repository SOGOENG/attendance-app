// Fictional rows / in-memory PGlite only. No production connections or secrets.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
const {PGlite}=await import(process.env.PGLITE_MODULE?pathToFileURL(process.env.PGLITE_MODULE).href:'@electric-sql/pglite');
const db=await PGlite.create(),q=async(s,a=[])=>(await db.query(s,a)).rows;
// Fixtures start as LF; tests explicitly construct the production CRLF variant.
const read=async f=>(await readFile(new URL('../'+f,import.meta.url),'utf8')).replace(/\r\n/g,'\n');
const uid=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const actor=async(n,role='authenticated')=>{await db.exec('reset role');await q("select set_config('request.jwt.claim.sub',$1,false)",[n?uid(n):'']);await db.exec('set role '+role);};
let groups=0;const test=async(name,fn)=>{await fn();console.log('PASS '+name);groups++;};
try{
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema public,auth to anon,authenticated,service_role;
 create table public.employees(id bigint primary key,auth_user_id uuid unique,active boolean,admin_scope text,is_leave_manager boolean default false);
 create table public.sites(id bigint primary key);
 create table public.holidays(id bigint generated always as identity primary key,date date,day_type text);
 create table public.attendance(id bigint generated always as identity primary key,employee_id bigint,work_date date,status text,site_type text,leave_type text,site_id bigint,misc_company text,misc_department text,company_work text,misc_name text,start_time text,end_time text,note text);
 insert into public.employees values(1,'${uid(1)}',true,'none',false),(2,'${uid(2)}',true,'none',false),(3,'${uid(3)}',true,'all',true),(4,'${uid(4)}',false,'none',false),(5,'${uid(5)}',true,'none',true);`);
 await db.exec(await read('supabase/application_management.sql'));
 const original=await read('tests/application_rpc_auth_original.sql');
 // Production uses CRLF; guards must explicitly accept it as well as reviewed LF.
 await db.exec(original.replace(/\n/g,'\r\n'));
 await db.exec('grant execute on function public.current_employee_id(),public.is_application_admin(),public.is_leave_manager() to anon,authenticated,service_role');
 await db.exec(await read('tests/application_rpc_auth_callers.sql'));
 const migration=await read('supabase/fix_application_rpc_authorization.sql');
 const make=async status=>{await actor(1,'postgres');return (await q("insert into applications(application_type,employee_id,status,approved_at,approved_by_employee_id,created_by_employee_id) values('paid_leave',1,$1,case when $1='approved' then now() end,case when $1='approved' then 3 end,1) returning id",[status]))[0].id;};
 const call=(fn,id)=>q(`select public.${fn}($1)`,[id]);
 const state=async id=>{await actor(null,'postgres');return (await q('select status from applications where id=$1',[id]))[0].status;};
 const signatures=['cancel_application(bigint,text)','reopen_application_draft(bigint)','recalculate_paid_leave_balance(bigint)'];
 const snapshot=()=>q("select oid,proowner,proacl,pg_get_functiondef(oid) definition from pg_proc where oid=any($1::regprocedure[]) order by oid",[signatures.map(s=>'public.'+s)]);
 const baseline=await snapshot();
 await test('original NULL bypass reaches history NOT NULL; no committed update',async()=>{
  for(const [fn,status] of [['cancel_application','submitted'],['reopen_application_draft','revision_required']]){
   const id=await make(status);await actor(null,'anon');await assert.rejects(call(fn,id),/changed_by_employee_id.*not-null/);assert.equal(await state(id),status);
  }
 });
 await test('original anonymous balance recalculation commits and clears auditor',async()=>{
  await actor(3,'postgres');await q('insert into paid_leave_balances(employee_id,fiscal_year,updated_by_employee_id) values(1,2026,3)');
  const id=(await q('select id from paid_leave_balances'))[0].id;
  await q("insert into paid_leave_balance_transactions(balance_id,transaction_type,days,source_key,created_by_employee_id) values($1,'grant',10,'opening:grant',3)",[id]);
  await actor(null,'anon');await call('recalculate_paid_leave_balance',id);
  await actor(null,'postgres');const row=(await q('select remaining_days,updated_by_employee_id from paid_leave_balances where id=$1',[id]))[0];assert.equal(Number(row.remaining_days),10);assert.equal(row.updated_by_employee_id,null);
 });
 await test('apply + repeat preserves owners, helper body, service access; only intended ACL changes',async()=>{
  await db.exec(migration);await db.exec(migration);
  const after=await snapshot();for(let i=0;i<after.length;i++)assert.equal(after[i].proowner,baseline[i].proowner);
  assert.equal(after.find(r=>r.definition.includes('FUNCTION public.recalculate_paid_leave_balance')).definition,baseline.find(r=>r.definition.includes('FUNCTION public.recalculate_paid_leave_balance')).definition);
  for(const role of ['anon','authenticated','service_role'])for(const sig of signatures){
   const ok=(await q("select has_function_privilege($1,$2,'EXECUTE') ok",[role,'public.'+sig]))[0].ok;
   assert.equal(ok,role==='service_role'||(role==='authenticated'&&!sig.startsWith('recalculate')));
  }
 });
 await test('anonymous and invalid employee blocked independently of history constraint',async()=>{
  await actor(null,'postgres');await db.exec('alter table application_status_history alter column changed_by_employee_id drop not null');
  for(const [fn,status] of [['cancel_application','submitted'],['reopen_application_draft','revision_required']])for(const [id,role] of [[null,'anon'],[null,'authenticated'],[4,'authenticated'],[99,'authenticated'],[null,'service_role']]){
   const app=await make(status);await actor(id,role);await assert.rejects(call(fn,app),role==='anon'?/permission denied/:/active_employee_required/);assert.equal(await state(app),status);
  }
 });
 await test('other employee forbidden; owner cancellation/reopen and admin cancellation retained',async()=>{
  for(const [fn,status] of [['cancel_application','submitted'],['reopen_application_draft','revision_required']]){
   const id=await make(status);await actor(2);await assert.rejects(call(fn,id),/forbidden/);
   await actor(1);await call(fn,id);assert.equal(await state(id),fn==='cancel_application'?'cancelled':'draft');
  }
  let id=await make('approved');await actor(1);await assert.rejects(call('cancel_application',id),/admin_required_to_cancel_approved_application/);
  await actor(3);await call('cancel_application',id);assert.equal(await state(id),'cancelled');
  id=await make('revision_required');await actor(3);await assert.rejects(call('reopen_application_draft',id),/forbidden/);
  // No implicit accounting cancellation permission is added.
  await actor(5);await assert.rejects(call('cancel_application',id),/forbidden/);
 });
 await test('direct recalculation denied; authenticated owner-based internal calls and service remain valid',async()=>{
  for(const [id,role] of [[null,'anon'],[1,'authenticated'],[2,'authenticated'],[3,'authenticated'],[5,'authenticated']]){await actor(id,role);await assert.rejects(call('recalculate_paid_leave_balance',1),/permission denied/);}
  await actor(5);await q("select public.set_paid_leave_opening_balance(1,2026,12,0,0,0,'2026-04-01')");
  await q("select public.register_admin_paid_leave_usage(1,'2026-08-03',1,$1,'fictional')",[uid(123)]);
  await actor(null,'postgres');assert.equal(Number((await q('select remaining_days from paid_leave_balances where employee_id=1 and fiscal_year=2026'))[0].remaining_days),11);
  await actor(null,'service_role');await call('recalculate_paid_leave_balance',1);
  await actor(null,'postgres');assert.equal(Number((await q('select remaining_days from paid_leave_balances where id=1'))[0].remaining_days),11);
 });
 await test('production accounting edit/delete and approval/cancellation still recalculate internally',async()=>{
  await actor(null,'postgres');const tx=(await q("select id from paid_leave_balance_transactions where source_key like 'admin_paid_usage:%' and active limit 1"))[0].id;
  await actor(5);await q("select public.update_admin_paid_leave_usage($1,1,'2026-08-03',2,'fictional edit')",[tx]);
  await actor(null,'postgres');assert.equal(Number((await q('select remaining_days from paid_leave_balances where id=1'))[0].remaining_days),10);
  await actor(5);await q('select public.delete_admin_paid_leave_usage($1,1)',[tx]);
  await actor(null,'postgres');assert.equal(Number((await q('select remaining_days from paid_leave_balances where id=1'))[0].remaining_days),12);
  const id=await make('submitted');await q("insert into paid_leave_application_details(application_id,start_date,end_date,days,day_part) values($1,'2026-08-04','2026-08-04',1,'full')",[id]);
  await actor(3);await q("select public.review_application($1,'approved','fictional approval')",[id]);
  await actor(null,'postgres');assert.equal(Number((await q('select remaining_days from paid_leave_balances where id=1'))[0].remaining_days),11);
  await actor(3);await call('cancel_application',id);
  await actor(null,'postgres');assert.equal(Number((await q('select remaining_days from paid_leave_balances where id=1'))[0].remaining_days),12);
 });
 await test('existing driving month source guard still blocks cancellation and reopen',async()=>{
  await actor(null,'postgres');const month=await read('supabase/add_driving_report_month_submission.sql');
  await db.exec(month.slice(0,month.indexOf('create function public.driving_closing_month'))+'commit;');
  await db.exec('alter table public.comp_leave_dates add column admin_direct boolean not null default false');
  for(const name of ['driving_closing_month','driving_month_lock','driving_calendar_lock','driving_month_balance_application','driving_month_source_guard']){
   const start=month.indexOf('create function public.'+name+'(');assert(start>=0);
   await db.exec(month.slice(start,month.indexOf('$$;',start)+3));
  }
  await db.exec('create trigger a_driving_month_source before insert or update or delete on public.applications for each row execute function public.driving_month_source_guard()');
  const cancelled=await make('submitted'),reopened=await make('revision_required');
  for(const id of [cancelled,reopened])await q("insert into paid_leave_application_details(application_id,start_date,end_date,days,day_part) values($1,'2026-08-05','2026-08-05',1,'full')",[id]);
  await q("insert into driving_report_month_submissions(employee_id,closing_month,period_start,period_end,submitted_by,snapshot) values(1,'2026-08-01','2026-07-21','2026-08-20',1,'{}')");
  await actor(3);await assert.rejects(call('cancel_application',cancelled),/driving_month_application_locked/);
  await actor(1);await assert.rejects(call('reopen_application_draft',reopened),/driving_month_application_locked/);
  assert.equal(await state(cancelled),'submitted');assert.equal(await state(reopened),'revision_required');
 });
 await test('preflight is SELECT-only and executes in a read-only transaction',async()=>{
  const sql=await read('supabase/application_rpc_authorization_preflight.sql');
  await db.exec('begin read only');const result=(await q(sql))[0].application_rpc_authorization_preflight;await db.exec('rollback');
  assert.equal(result.history_actor_column.not_null,false);assert.equal(result.functions.length,3);
 });
 await test('unexpected ACL/body/owner and inherited permission stop without partial changes',async()=>{
  await actor(null,'postgres');await db.exec('create role unexpected;grant execute on function public.cancel_application(bigint,text) to unexpected');
  await assert.rejects(db.exec(migration),/requires_review/);await db.exec('rollback');
  await db.exec('revoke execute on function public.cancel_application(bigint,text) from unexpected');
  const before=await snapshot();await db.exec('alter function public.reopen_application_draft(bigint) owner to unexpected');
  await assert.rejects(db.exec(migration),/requires_review/);await db.exec('rollback');
  await db.exec('alter function public.reopen_application_draft(bigint) owner to postgres');
  await db.exec("create or replace function public.reopen_application_draft(p_application_id bigint) returns void language plpgsql security definer set search_path=public,pg_temp as $$begin null;end$$");
  await assert.rejects(db.exec(migration),/requires_review/);await db.exec('rollback');
  await db.exec(before.find(r=>r.definition.includes('FUNCTION public.reopen_application_draft')).definition);
  // Owner membership creates inherited EXECUTE while explicit ACL stays exact.
  await db.exec('grant postgres to authenticated');
  await assert.rejects(db.exec(migration),/inherited_execute_requires_review/);await db.exec('rollback');await db.exec('revoke postgres from authenticated');
  assert.deepEqual(await snapshot(),before);
 });
 await test('safe employee registration/ACL migration preserves actual application cancellation and ownership checks',async()=>{
  await actor(null,'postgres');
  const definitions=await snapshot();
  await db.exec(`create table auth.users(id uuid primary key,email text,raw_app_meta_data jsonb,banned_until timestamptz,email_confirmed_at timestamptz);
   alter table public.employees add column name text default '社員',add column department text default '工事部',
    add column job_title text,add column profile_email text,add column phone_number text,
    add column attendance_required boolean default true,add column improvement_required boolean default true,add column near_miss_required boolean default true;
   create table public.fuel_receipt_roles(employee_id bigint primary key);`);
  for(const file of ['add_employee_management_rpc.sql','add_employee_creation_operations.sql','add_employee_safe_registration.sql','restrict_employee_direct_writes.sql'])await db.exec(await read('supabase/'+file));
  assert.deepEqual(await snapshot(),definitions);
  const id=await make('submitted');
  await actor(2);await assert.rejects(call('cancel_application',id),/forbidden/);
  await actor(1);await call('cancel_application',id);
  assert.equal(await state(id),'cancelled');
 });
 console.log(`Application RPC authorization: ${groups} groups passed.`);
}catch(e){console.error(e.message,e.code,e.where||'');process.exitCode=1;}finally{await db.close();}
