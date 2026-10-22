// In-memory PostgreSQL only. No production connection.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
const {PGlite}=await import(process.env.PGLITE_MODULE?pathToFileURL(process.env.PGLITE_MODULE).href:'@electric-sql/pglite');
const db=await PGlite.create(),q=async(sql,args=[]) => (await db.query(sql,args)).rows;
const uid=id=>`00000000-0000-0000-0000-${String(id).padStart(12,'0')}`;
const actor=async(id,role='authenticated')=>{await db.exec('reset role');await q("select set_config('request.jwt.claim.sub',$1,false)",[id?uid(id):'']);await db.exec('set role '+role);};
const get=async(car=1,date='2026-09-01')=>(await q('select public.get_vehicle_initial_data($1,$2) d',[car,date]))[0].d;
const meter=async(car=1,date='2026-09-01')=>(await q('select public.previous_vehicle_end_odometer($1,$2) n',[car,date]))[0].n;
const save=async(revision=null,car=1,value=100)=>q(`select public.save_vehicle_initial_data($1,'2026-08-20',$2,'2026-08-19',90,10,'Station','Cash',$3) d`,[car,value,revision]);
let count=0;async function test(name,fn){await fn();console.log('PASS INITIAL DB '+name);count++;}
try{
 await db.exec(`create role authenticated;create role anon;create role service_role;
 create schema auth;
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema auth to authenticated,anon;
 create table public.vehicles(id bigint primary key,vehicle_number text,vehicle_name text,active boolean);
 create table public.employees(id bigint primary key,auth_user_id uuid,active boolean,default_vehicle_id bigint,admin_scope text);
 insert into public.vehicles values(1,'A','Car',true),(2,'B','Car',true),(3,'C','Car',false);
 insert into public.employees values(1,'${uid(1)}',true,1,'none'),(2,'${uid(2)}',true,2,'none'),(3,'${uid(3)}',true,null,'all'),(4,'${uid(4)}',false,null,'none'),
 (5,'${uid(5)}',true,null,'department'),(6,'${uid(6)}',true,null,'tool_admin'),(7,'${uid(7)}',false,null,'all');
 create function public.current_employee_id() returns bigint language sql stable security definer set search_path='' as $$select id from public.employees where auth_user_id=auth.uid() and active$$;
 create function public.is_application_admin() returns boolean language sql stable security definer set search_path='' as $$select exists(select 1 from public.employees where id=public.current_employee_id() and admin_scope='all')$$;
 create table public.driving_reports(id bigint primary key,employee_id bigint,vehicle_id bigint,report_date date,status text,driving_status text,end_odometer numeric);
 create table public.driving_refuels(id bigint primary key,driving_report_id bigint,refueled_at timestamptz,odometer_km numeric,liters numeric,fuel_station text,payment_method text);
 alter table public.driving_reports enable row level security;
 alter table public.employees enable row level security;`);
 // Use the exact repository helpers, rather than a simplified admin mock.
 const app=await readFile(new URL('../supabase/application_management.sql',import.meta.url),'utf8');
 for(const name of ['current_employee_id','is_application_admin']){
   const start=app.indexOf('create or replace function public.'+name+'()');
   await db.exec(app.slice(start,app.indexOf('$$;',start)+3));
 }
 const migration=await readFile(new URL('../supabase/add_vehicle_initial_data.sql',import.meta.url),'utf8');
 const preflight=await readFile(new URL('../supabase/vehicle_initial_data_preflight.sql',import.meta.url),'utf8');
 await test('SELECT preflight handles initial table / RPC absence before installation',async()=>{
   const result=(await q(preflight))[0].vehicle_initial_data_preflight;
   assert(!result.tables.some(t=>t.name==='vehicle_initial_data'));
   assert.equal(result.required_columns.filter(r=>r.status!=='OK').length,0);
   assert.equal(result.required_functions.find(f=>f.signature==='public.get_vehicle_initial_data(bigint,date)').exists,false);
 });
 await db.exec(migration);
 await test('real application admin helper: all only, active Auth link required',async()=>{
   for(const [id,expected] of [[1,false],[3,true],[4,false],[5,false],[6,false],[7,false],[99,false],[null,false]]){
     await actor(id);assert.equal((await q('select public.is_application_admin() ok'))[0].ok,expected);
     if(!expected&&id!==1)await assert.rejects(save(),/vehicle_initial_access_denied/);
   }
 });
 await actor(1);
 await test('no seed / no history',async()=>{assert.equal((await get()).initial,null);assert.equal((await get()).has_history,false);assert.equal(await meter(),null);});
 await test('seed fallback and previous fuel',async()=>{await save();assert.equal(Number(await meter()),100);assert.equal((await get()).previous_refuel.source,'initial');assert.equal(await meter(1,'2026-08-20'),null);});
 await test('correction preserves creator / one row / stale revision rejected',async()=>{const old=(await get()).initial;await save(1,1,110);assert.equal(Number(await meter()),110);const row=(await get()).initial;assert.equal(row.created_at,old.created_at);assert.equal(row.revision,2);await assert.rejects(save(1),/initial_revision_conflict/);await assert.rejects(save(),/initial_revision_conflict/);});
 await test('other employee cannot read or edit; unlinked / inactive denied',async()=>{for(const id of [2,4,99,null]){await actor(id);await assert.rejects(get(),/vehicle_initial_access_denied/);await assert.rejects(save(2),/vehicle_initial_access_denied/);}await actor(1);});
 await test('no direct table writes / anon execute',async()=>{await assert.rejects(q('update public.vehicle_initial_data set end_odometer=1'),/permission denied/);await assert.rejects(q('select * from public.vehicle_initial_data'),/permission denied/);await actor(1,'anon');await assert.rejects(get(),/permission denied/);await actor(1);});
 await test('optional fuel blank; partial fuel rejected; precision rejected',async()=>{await actor(2);await q("select public.save_vehicle_initial_data(2,'2026-08-20',50,null,null,null,null,null,null)");assert.equal((await get(2)).previous_refuel,null);await assert.rejects(q("select public.save_vehicle_initial_data(2,'2026-08-20',50,'2026-08-19',null,10,null,null,1)"),/check constraint/);await assert.rejects(q("select public.save_vehicle_initial_data(2,'2026-08-20',50.12,null,null,null,null,null,1)"),/invalid_initial_values/);await actor(1);});
 await actor(null,'postgres');
 await q("insert into public.driving_reports values(1,1,1,'2026-08-22','draft','driven',999)");
 await actor(1);
 await test('month-mode saved draft end meter overrides seed; empty / same-day / future excluded',async()=>{
   assert.equal(Number(await meter()),999);assert.equal((await get()).has_meter_history,true);
   assert.equal(Number(await meter(1,'2026-08-22')),110);
   await actor(null,'postgres');await q("insert into public.driving_reports values(10,1,1,'2026-08-23','draft','driven',null),(11,1,1,'2026-09-02','draft','driven',1000)");await actor(1);
   assert.equal(Number(await meter()),999);
 });
 await actor(null,'postgres');await q("update public.driving_reports set status='submitted',end_odometer=120 where id=1");await actor(1);
 await test('submitted history wins even after seed correction',async()=>{assert.equal(Number(await meter()),120);await save(2,1,115);assert.equal(Number(await meter()),120);assert.equal((await get()).has_history,true);});
 await test('newer completed draft wins over older submitted meter (existing carryover)',async()=>{
   await actor(null,'postgres');await q("update public.driving_reports set end_odometer=125 where id=10");await actor(1);
   assert.equal(Number(await meter()),125);
   await actor(null,'postgres');await q('update public.driving_reports set end_odometer=null where id=10');await actor(1);
 });
 await actor(null,'postgres');await q("insert into public.driving_reports values(2,2,1,'2026-08-22','submitted','driven',130)");await actor(1);
 await test('conflicting history returns null, never seed',async()=>assert.equal(await meter(),null));
 await actor(null,'postgres');await q("insert into public.driving_refuels values(1,1,'2026-08-22T00:00:00+09:00',120,15,null,null)");await actor(1);
 await test('actual fuel history wins',async()=>assert.equal((await get()).previous_refuel.source,'report'));
 await actor(null,'postgres');await q('update public.employees set default_vehicle_id=null where id=1');await q('update public.employees set default_vehicle_id=1 where id=2');await actor(2);
 await test('new assignee cannot overwrite original creator',async()=>await assert.rejects(save(3),/initial_creator_required/));
 await actor(3);
 await test('application admin can correct any seed / inactive car',async()=>{await save(3,1,116);assert.equal((await get()).initial.updated_by,3);await q("select public.save_vehicle_initial_data(3,'2026-08-20',1,null,null,null,null,null,null)");assert.equal(Number(await meter(3)),1);});
 await test('reapply twice preserves seeds, revisions, reports, refuels and effective ACL',async()=>{
   await actor(null,'postgres');
   const snapshot=async()=>JSON.stringify(await q(`select (select jsonb_agg(to_jsonb(v) order by vehicle_id) from public.vehicle_initial_data v) seeds,
     (select jsonb_agg(to_jsonb(r) order by id) from public.driving_reports r) reports,
     (select jsonb_agg(to_jsonb(f) order by id) from public.driving_refuels f) refuels,
     has_function_privilege('anon','public.save_vehicle_initial_data(bigint,date,numeric,date,numeric,numeric,text,text,bigint)','execute') anon,
     has_table_privilege('authenticated','public.vehicle_initial_data','update') direct_update`));
   const before=await snapshot();await db.exec(migration);await db.exec(migration);assert.equal(await snapshot(),before);
   await actor(3);assert.equal((await get()).initial.revision,4);assert.equal(Number(await meter(3)),1);
 });
 await test('incompatible same-name schema stops and rolls back without touching rows',async()=>{
   await actor(null,'postgres');const before=JSON.stringify(await q('select * from public.vehicle_initial_data order by vehicle_id'));
   await q('alter table public.vehicle_initial_data add column unexpected text');
   await assert.rejects(db.exec(migration),/vehicle_initial_data_schema_mismatch/);await db.exec('rollback');
   assert.equal(JSON.stringify(await q('select * from public.vehicle_initial_data order by vehicle_id')),JSON.stringify(JSON.parse(before).map(r=>({...r,unexpected:null}))));
   await q('alter table public.vehicle_initial_data drop column unexpected');
   assert.equal(JSON.stringify(await q('select * from public.vehicle_initial_data order by vehicle_id')),before);
 });
 await test('SELECT preflight returns schema / definitions / ACL without changing rows',async()=>{
   await actor(null,'postgres');
   const before=JSON.stringify(await q('select * from public.vehicle_initial_data order by vehicle_id'));
   const result=(await q(preflight))[0].vehicle_initial_data_preflight;
   assert.equal(result.required_columns.filter(r=>r.status!=='OK').length,0);
   assert(result.functions_all_overloads.some(f=>f.name==='is_application_admin'));
   assert(result.tables.some(t=>t.name==='vehicle_initial_data'&&t.rls));
   assert.equal(result.function_execute.find(f=>f.name==='save_vehicle_initial_data'&&f.role==='anon').execute,false);
   assert.equal(JSON.stringify(await q('select * from public.vehicle_initial_data order by vehicle_id')),before);
 });
 console.log(`Initial DB: ${count} groups passed.`);
}finally{await db.close();}
