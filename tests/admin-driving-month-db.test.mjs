// Full repository driving schema/validators/month submission, in-memory only.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import vm from 'node:vm';
const {PGlite}=await import(process.env.PGLITE_MODULE?pathToFileURL(process.env.PGLITE_MODULE).href:'@electric-sql/pglite');
const db=await PGlite.create(),q=async(s,a=[])=>(await db.query(s,a)).rows;
const read=f=>readFile(new URL('../'+f,import.meta.url),'utf8');
const uid=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
const actor=async(n,role='authenticated')=>{await db.exec('reset role');await q("select set_config('request.jwt.claim.sub',$1,false)",[n?uid(n):'']);await db.exec('set role '+role);};
const extract=(s,name)=>{const start=s.indexOf('create or replace function public.'+name+'(');assert(start>=0,name);return s.slice(start,s.indexOf('$$;',start)+3);};
let count=0;const test=async(name,fn)=>{await fn();count++;console.log('PASS '+name);};
try{
 let setup=(await read('tests/fuel-receipts-setup.sql')).split('insert into public.employees')[0];
 setup=setup.replace(/^\\set.*\n/gm,'');
 for(const line of setup.match(/^\\ir .+$/gm)||[]){const included=await read('supabase/'+line.split('/').at(-1));setup=setup.replace(line,()=>included);}
 await db.exec(setup);
 await db.exec(`alter table public.employees add column is_leave_manager boolean not null default false;
 alter table public.employees add column job_title text,add column profile_email text,add column phone_number text,
 add column attendance_required boolean default true,add column improvement_required boolean default true,add column near_miss_required boolean default true;
 insert into public.employees(id,auth_user_id,active,name,department,admin_scope) values
 (1,'${uid(1)}',true,'Worker','工事部','none'),(2,'${uid(2)}',true,'Dept','工事部','工事部'),
 (3,'${uid(3)}',true,'Admin','工事部','all'),(4,'${uid(4)}',false,'Inactive','工事部','all');
 create table public.holidays(id bigint generated always as identity,date date,day_type text);
 create table public.attendance(id bigint generated always as identity,employee_id bigint,work_date date,site_type text,leave_type text,status text,
 source_type text,source_application_id bigint,site_id bigint,misc_company text,misc_department text,company_work text,misc_name text,start_time text,end_time text,note text);
 create table public.holiday_work_records(id bigint generated always as identity,employee_id bigint,work_date date,status text default 'active');
 create table public.applications(id bigint primary key,employee_id bigint references public.employees(id),status text,application_type text,reviewer_comment text);
 create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text);`);
 const app=await read('supabase/application_management.sql');
 await db.exec(app.slice(app.indexOf('create table if not exists public.paid_leave_application_details'),app.indexOf('create table if not exists public.paid_leave_balances')));
 await db.exec('alter table public.comp_leave_dates add column admin_direct boolean not null default false');
 await db.exec('create role custom_reader;alter default privileges grant execute on functions to custom_reader');
 for(const f of ['add_driving_report_destination.sql','add_driving_report_submission.sql','add_pre_drive_alcohol_checks.sql','add_fuel_receipts.sql','add_driving_report_month_submission.sql','fix_driving_month_calendar_holiday_attendance.sql','add_employee_management_rpc.sql'])await db.exec(await read('supabase/'+f));
 const ctx=vm.createContext({window:{},Intl,URLSearchParams,Date});for(const f of ['driving-report-period.js','driving-report-month-followup.js'])vm.runInContext(await read(f),ctx);
 const p=ctx.window.DrivingReportPeriod,follow=ctx.window.DrivingReportMonthFollowup;
 const now=(await q("select (statement_timestamp() at time zone 'Asia/Tokyo')::date::text t"))[0].t;
 const month=p.shift(p.closingMonth(now),-2),span=p.range(month),d=span.days;
 await q("insert into public.holidays(date,day_type) select x::date,'出勤' from generate_series($1::date,$2::date,interval '1 day') x",[span.start,span.end]);
 await q("update public.holidays set day_type='休日' where date=any($1::date[])",[[d[2],d[6],d[7]]]);
 await actor(1,'postgres');
 await q("insert into public.driving_reports(employee_id,report_date,driving_status) values(1,$1,'driven'),(1,$2,'no_driving'),(1,$3,'no_driving')",[d[1],d[7],d[10]]);
 await q("insert into public.applications(id,employee_id,status,application_type) values(10,1,'approved','paid_leave'),(11,1,'approved','paid_leave'),(12,1,'approved','paid_leave')");
 await q("insert into public.paid_leave_application_details(application_id,start_date,end_date,days,day_part) values(10,$1,$1,1,'full'),(11,$2,$2,0.5,'am'),(12,$3,$3,0.5,'am')",[d[3],d[4],d[5]]);
 await q('insert into public.holiday_work_records(employee_id,work_date) values(1,$1),(1,$2)',[d[5],d[6]]);
 await q("insert into public.attendance(employee_id,work_date,site_type,status) values(1,$1,'会社勤務','draft')",[d[8]]);
 await actor(1);const original=(await q('select public.check_driving_report_month($1) c',[month+'-01']))[0].c;
 await actor(null,'postgres');
 const wrapperAcl=await q("select oid,proowner,proacl from pg_proc where oid in ('public.check_driving_report_month(date)'::regprocedure,'public.driving_report_validate_submission(public.driving_reports)'::regprocedure) order by oid");
 const otherDefs=await q("select oid,pg_get_functiondef(oid) d,proacl from pg_proc where proname in ('submit_driving_report_month','is_application_admin','is_leave_manager','fuel_receipt_command','set_my_default_vehicle') order by oid");
 const employeeRows=JSON.stringify(await q('select id,name,active,default_vehicle_id from public.employees order by id'));
 await db.exec(await read('supabase/add_employee_driving_report_target.sql'));
 await db.exec(await read('supabase/add_employee_management_rpc.sql'));
 // Model the reviewed production validator body and ACLs, including CRLF.
 const validator=extract(await read('supabase/add_pre_drive_alcohol_checks.sql'),'driving_report_validate_submission');
 await db.exec(validator.replace(/\n/g,'\r\n'));
 assert.equal((await q("select md5(prosrc) h from pg_proc where oid='public.driving_report_validate_submission(public.driving_reports)'::regprocedure"))[0].h,'8d06f197a323fc46ad28e716a62335b6');
 await db.exec('revoke all on function public.driving_report_validate_submission(public.driving_reports) from public,anon,authenticated;grant execute on function public.driving_report_validate_submission(public.driving_reports) to service_role');
 // Re-snapshot the production-style ACL before sharing.
 wrapperAcl.splice(0,wrapperAcl.length,...await q("select oid,proowner,proacl from pg_proc where oid in ('public.check_driving_report_month(date)'::regprocedure,'public.driving_report_validate_submission(public.driving_reports)'::regprocedure) order by oid"));
 // Match production helper/table privileges rather than relying on ACL equality.
 await db.exec('grant execute on function public.current_employee_id(),public.driving_report_inspection_items() to service_role;grant select on public.driving_report_inspections,public.driving_alcohol_checks,public.driving_refuels to service_role;alter role service_role bypassrls');
 const serviceBase=(await q("select to_jsonb(r) r from public.driving_reports r where employee_id=1 and driving_status='no_driving' limit 1"))[0].r;
 const serviceCases=[serviceBase,{...serviceBase,vehicle_id:123},
  {...serviceBase,driving_status:'invalid'}, {...serviceBase,driving_status:'driven'},
  {...serviceBase,driving_status:'driven',vehicle_id:123,outbound_route_type:'commute',return_route_type:'commute',start_odometer:20,end_odometer:10},
  {...serviceBase,driving_status:'driven',vehicle_id:123,outbound_route_type:'commute',return_route_type:'commute',start_odometer:10,end_odometer:20}];
 const serviceCall=r=>q('select public.driving_report_validate_submission(jsonb_populate_record(null::public.driving_reports,$1::jsonb))',[r]);
 const serviceOutcome=async r=>{try{await serviceCall(r);return 'OK';}catch(e){return e.code+':'+e.message;}};
 const originalService=[];
 await actor(1,'service_role');for(const r of serviceCases)originalService.push(await serviceOutcome(r));
 assert.deepEqual(originalService,['OK','P0001:no_driving_must_not_have_driving_data','P0001:invalid_driving_status','P0001:driving_submission_fields_required','P0001:end_odometer_before_start','P0001:all_13_official_inspections_required']);
 await actor(null,'postgres');
 const migration=await read('supabase/add_admin_driving_month_status.sql');
 const helperGrant='grant execute on function public.driving_report_validate_fields_internal(public.driving_reports) to service_role;';
 assert(migration.includes(helperGrant));
 await test('reproduce pre-fix service execution failure then restore compatibility',async()=>{
  await db.exec(migration.replace(helperGrant,''));await actor(1,'service_role');
  await assert.rejects(serviceCall(serviceBase),/permission denied for function driving_report_validate_fields_internal/);
  await actor(null,'postgres');await db.exec(migration);
  await actor(1,'service_role');for(let i=0;i<serviceCases.length;i++)assert.equal(await serviceOutcome(serviceCases[i]),originalService[i]);
  for(const id of [3,null]){await actor(id,'service_role');await assert.rejects(serviceCall(serviceBase),/own_report_required/);}
  await actor(1,'postgres');
  const driven=(await q("select to_jsonb(r) r from public.driving_reports r where employee_id=1 and driving_status='driven' limit 1"))[0].r;
  await q("insert into public.driving_report_inspections(driving_report_id,inspection_item_code,result,checked_at) select $1,inspection_item_code,'ok',now() from public.driving_report_inspection_items()",[driven.id]);
  const complete={...driven,vehicle_id:123,outbound_route_type:'commute',return_route_type:'commute',start_odometer:10,end_odometer:20};
  await db.exec(validator.replace(/\n/g,'\r\n'));
  const alcoholOriginal=[];await actor(1,'service_role');
  for(const version of [1,2])alcoholOriginal.push(await serviceOutcome({...complete,alcohol_check_version:version}));
  assert.deepEqual(alcoholOriginal,['P0001:before_and_after_alcohol_checks_required','P0001:both_pre_drive_alcohol_checks_required']);
  await actor(null,'postgres');await db.exec(migration);await actor(1,'service_role');
  for(const [i,version] of [1,2].entries())assert.equal(await serviceOutcome({...complete,alcohol_check_version:version}),alcoholOriginal[i]);
  await actor(1,'postgres');await q('delete from public.driving_report_inspections where driving_report_id=$1',[driven.id]);
  const flags=(await q("select prosecdef from pg_proc where oid='public.driving_report_validate_submission(public.driving_reports)'::regprocedure"))[0];assert.equal(flags.prosecdef,false);
 });
 await test('initial flags OFF; additive target upgrade preserves records; exact guards and reapply',async()=>{
  assert.equal((await q('select count(*)::int n from public.employees where driving_report_required'))[0].n,0);
  assert.equal(JSON.stringify(await q('select id,name,active,default_vehicle_id from public.employees order by id')),employeeRows);
  await db.exec(migration);await db.exec(await read('supabase/add_employee_driving_report_target.sql'));
  assert.deepEqual(await q("select oid,proowner,proacl from pg_proc where oid in ('public.check_driving_report_month(date)'::regprocedure,'public.driving_report_validate_submission(public.driving_reports)'::regprocedure) order by oid"),wrapperAcl);
  assert.deepEqual(await q("select oid,pg_get_functiondef(oid) d,proacl from pg_proc where proname in ('submit_driving_report_month','is_application_admin','is_leave_manager','fuel_receipt_command','set_my_default_vehicle') order by oid"),otherDefs);
 });
 await test('split installation needs no creation SQL; direct writes blocked; login SELECT and service ACL preserved',async()=>{
  await actor(null,'postgres');
  assert.equal((await q("select to_regclass('public.employee_creation_operations') t,to_regprocedure('public.begin_employee_creation(uuid,uuid,jsonb)') f"))[0].t,null);
  await db.exec('grant select,insert,update,delete,truncate on public.employees to anon,authenticated,service_role;grant update(active),insert(name) on public.employees to anon,authenticated');
  const serviceBefore=await q("select p,has_table_privilege('service_role','public.employees',p) v from unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE']) p order by p");
  await db.exec(await read('supabase/restrict_employee_direct_writes.sql'));
  await db.exec(await read('supabase/restrict_employee_direct_writes.sql'));
  assert.deepEqual(await q("select p,has_table_privilege('service_role','public.employees',p) v from unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE']) p order by p"),serviceBefore);
  for(const role of ['anon','authenticated']){
   await actor(null,role);await q('select id from public.employees limit 1');
   for(const command of ["update public.employees set admin_scope='all' where id=1","insert into public.employees(id,name,department) values(90,'X','工事部')","delete from public.employees where id=1","truncate public.employees"])
    await assert.rejects(db.exec(command),/permission denied/);
  }
  await actor(null,'postgres');
  for(const name of ['employee_edit_internal','employee_edit_context','admin_edit_employee','department_edit_employee'])assert.equal((await q("select bool_or(has_function_privilege('custom_reader',oid,'EXECUTE')) v from pg_proc where proname=$1",[name]))[0].v,false);
  await actor(3);const context=(await q('select public.employee_edit_context() c'))[0].c;
  assert.equal(context.creation_enabled,false);assert.equal(context.creation_management_enabled,false);
 });
 await test('repeat keeps only service field-helper execution; user/admin/anon cannot bypass wrappers',async()=>{
  await actor(null,'postgres');await db.exec(migration);
  for(const [id,role] of [[1,'authenticated'],[3,'authenticated'],[null,'anon'],[3,'custom_reader']]){
   await actor(id,role);
   await assert.rejects(q('select public.driving_report_validate_fields_internal(jsonb_populate_record(null::public.driving_reports,$1::jsonb))',[serviceBase]),/permission denied/);
   await assert.rejects(serviceCall(serviceBase),/permission denied/);
  }
  await actor(1,'service_role');assert.equal(await serviceOutcome(serviceBase),'OK');
  for(const sql of ['select public.driving_check_month_internal(1,$1)','select public.driving_month_admin_guard($1)','select public.admin_driving_month_status($1)','select public.admin_driving_month_days(1,$1)'])await assert.rejects(q(sql,[month+'-01']),/permission denied/);
  await actor(null,'postgres');
 });
 await test('own check is identical; own validator still denies another employee; internals private',async()=>{
  await actor(1);assert.deepEqual((await q('select public.check_driving_report_month($1) c',[month+'-01']))[0].c,original);
  for(const sql of ["select public.driving_check_month_internal(1,$1)","select public.driving_month_admin_guard($1)"])await assert.rejects(q(sql,[month+'-01']),/permission denied/);
  await actor(3,'postgres');const report=(await q('select * from public.driving_reports limit 1'))[0];
  await assert.rejects(q('select public.driving_report_validate_submission(r) from public.driving_reports r where id=$1',[report.id]),/own_report_required/);
 });
 await test('full admin edits own/other target flag through existing RPC; dept cannot change flag',async()=>{
  await actor(null,'postgres');const row=(await q('select * from public.employees where id=1'))[0];
  const keys=['name','department','job_title','profile_email','phone_number','active','admin_scope','attendance_required','improvement_required','near_miss_required','driving_report_required'];
  const expected=Object.fromEntries(keys.map(k=>[k,row[k]??null]));
  await actor(3);await q('select public.admin_edit_employee(1,$1,$2)',[{...expected,driving_report_required:true},expected]);
  const own=(await q('select public.admin_driving_month_days(3,$1) c',[month+'-01']))[0].c;assert.equal(own.employee.driving_report_required,false);
  await actor(3,'postgres');const self=(await q('select * from public.employees where id=3'))[0];const ownExpected=Object.fromEntries(keys.map(k=>[k,self[k]??null]));
  await actor(3);const saved=(await q('select public.admin_edit_employee(3,$1,$2) c',[{...ownExpected,driving_report_required:true},ownExpected]))[0].c;assert.equal(saved.driving_report_required,true);
  const restore=Object.fromEntries(keys.map(k=>[k,saved[k]??null]));await q('select public.admin_edit_employee(3,$1,$2)',[{...restore,driving_report_required:false},restore]);
  await actor(2);await assert.rejects(q('select public.department_edit_employee(1,$1,$2)',[{name:'attack',attendance_required:true,improvement_required:true,near_miss_required:true,driving_report_required:false},{name:row.name,attendance_required:true,improvement_required:true,near_miss_required:true}]),/invalid_employee_values/);
 });
 await test('admin overview and detail use identical RPC decisions; holiday/leave/input errors classified',async()=>{
  await actor(3);const list=(await q('select public.admin_driving_month_status($1) c',[month+'-01']))[0].c;
  assert.equal(list.total,1);assert.equal(list.employees[0].id,1);assert.equal(list.period_start,span.start);assert.equal(list.period_end,span.end);
  const detail=(await q('select public.admin_driving_month_days(1,$1) c',[month+'-01']))[0].c;
  const counts={missing:0,incomplete:0,review:0};
  for(const day of detail.days){const raw=original.days.find(r=>r.date===day.date);assert.equal(day.kind,follow.classify(day.date,now,raw,original.errors,null,false).kind);if(day.kind in counts)counts[day.kind]++;}
  for(const k in counts)assert.equal(Number(list.employees[0][k]),counts[k]);
  for(const [date,kind] of [[d[1],'incomplete'],[d[2],'exempt'],[d[3],'exempt'],[d[4],'review'],[d[5],'missing'],[d[6],'missing'],[d[7],'ready'],[d[8],'review']])assert.equal(detail.days.find(x=>x.date===date).kind,kind);
  assert(!JSON.stringify(detail).includes('auth_user_id'));assert(!JSON.stringify(detail).includes('leave_application_id'));
 });
 await test('dept/general/inactive/unlinked/anon/service rejected; future and year periods validated',async()=>{
  for(const id of [1,2,4,99,null]){await actor(id);await assert.rejects(q('select public.admin_driving_month_status($1)',[month+'-01']),/admin_required/);await assert.rejects(q('select public.admin_driving_month_days(1,$1)',[month+'-01']),/admin_required/);}
  for(const role of ['anon','service_role','custom_reader']){await actor(3,role);await assert.rejects(q('select public.admin_driving_month_status($1)',[month+'-01']),/permission denied/);}
  await actor(3);const jan=(await q("select public.admin_driving_month_days(1,'2027-01-01') c"))[0].c;assert.equal(jan.period_start,'2026-12-21');assert.equal(jan.period_end,'2027-01-20');
  await assert.rejects(q("select public.admin_driving_month_status('2026-10-20')"),/invalid_closing_month/);
 });
 await test('20/21 boundaries, today/future exclusion, inactive targets and roster-change token',async()=>{
  await actor(null,'postgres');
  assert.equal((await q("select public.driving_closing_month('2026-10-20')::text m"))[0].m,'2026-10-01');
  assert.equal((await q("select public.driving_closing_month('2026-10-21')::text m"))[0].m,'2026-11-01');
  for(const [date,kind] of [[now,'today'],[p.range(p.shift(p.closingMonth(now),1)).end,'future']]){
   const day={date,required:true,report_id:null,status:null,issue:'report_missing'};
   assert.equal((await q('select public.driving_month_day_kind_internal($1,$2,false) k',[day,now]))[0].k,kind);
  }
  await actor(3);const first=(await q('select public.admin_driving_month_status($1) c',[month+'-01']))[0].c;
  await actor(null,'postgres');await q('update public.employees set driving_report_required=true where id=4');
  await actor(3);const next=(await q('select public.admin_driving_month_status($1) c',[month+'-01']))[0].c;
  assert.equal(next.total,2);assert.equal(next.employees.find(e=>e.id===4).active,false);assert.notEqual(next.roster_token,first.roster_token);
  await actor(null,'postgres');await q('update public.employees set driving_report_required=false where id=4');
 });
 await test('custom default grants cannot expose private cores; insufficient owner cannot produce false zero',async()=>{
  await actor(null,'postgres');
  assert.equal((await q("select has_function_privilege('custom_reader','public.driving_check_month_internal(bigint,date)','execute') ok"))[0].ok,false);
  await db.exec('create role limited_owner;alter function public.driving_check_month_internal(bigint,date) owner to limited_owner');
  await actor(3);await assert.rejects(q('select public.admin_driving_month_status($1)',[month+'-01']),/permission denied|row-level security/);
  await actor(null,'postgres');await db.exec('alter function public.driving_check_month_internal(bigint,date) owner to postgres');
 });
 await test('real monthly submission still validates and locks; admin sees submitted timestamp and zero action counts',async()=>{
  await actor(1,'postgres');
  await q("update public.applications set status='rejected' where id=11");
  await q("update public.attendance set status='submitted' where employee_id=1");
  await q("update public.driving_reports set driving_status='no_driving' where employee_id=1");
  await q("insert into public.driving_reports(employee_id,report_date,driving_status) select 1,x::date,'no_driving' from generate_series($1::date,$2::date,interval '1 day') x on conflict(employee_id,report_date) do nothing",[span.start,span.end]);
  await actor(1);assert.equal((await q('select public.check_driving_report_month($1) c',[month+'-01']))[0].c.valid,true);
  await q('select public.submit_driving_report_month($1)',[month+'-01']);
  await assert.rejects(q("update public.driving_reports set driving_status='driven' where employee_id=1"),/driving_month_already_submitted/);
  await actor(3);const summary=(await q('select public.admin_driving_month_status($1) c',[month+'-01']))[0].c.employees[0];
  assert.equal(summary.submitted,true);assert(summary.submitted_at);assert.equal(summary.missing+summary.incomplete+summary.review,0);
 });
 await test('unknown installed rule stops transaction; no mutation or proxy submission',async()=>{
  await actor(null,'postgres');const before=JSON.stringify(await q('select id,status from public.driving_reports order by id'));
  await db.exec("create or replace function public.check_driving_report_month(p_closing_month date) returns jsonb language plpgsql security definer as $$begin return '{}'::jsonb;end$$");
  await assert.rejects(db.exec(migration),/driving_month_definition_requires_review/);await db.exec('rollback');
  assert.equal(JSON.stringify(await q('select id,status from public.driving_reports order by id')),before);
  assert.equal((await q('select count(*)::int n from public.driving_report_month_submissions'))[0].n,1);
 });
 await test('unknown employee RPC stops repeat installation without overwriting it',async()=>{
  await actor(null,'postgres');
  await db.exec("create or replace function public.employee_edit_context() returns jsonb language plpgsql security definer as $$begin return '{}'::jsonb;end$$");
  const before=(await q("select pg_get_functiondef('public.employee_edit_context()'::regprocedure) d"))[0].d;
  await assert.rejects(db.exec(await read('supabase/add_employee_management_rpc.sql')),/employee_rpc_definition_requires_review/);
  await db.exec('rollback');assert.equal((await q("select pg_get_functiondef('public.employee_edit_context()'::regprocedure) d"))[0].d,before);
 });
 console.log(`Admin month DB: ${count} groups passed.`);
}catch(error){console.error(error.message,error.code,error.where||'');process.exitCode=1;}finally{await db.close();}
