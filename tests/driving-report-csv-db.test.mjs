// Fresh in-memory PostgreSQL (PGlite), never connects to any remote database.
// PGLITE_MODULE may point to a local official @electric-sql/pglite dist/index.js.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import vm from 'node:vm';
const { PGlite }=await import(process.env.PGLITE_MODULE?pathToFileURL(process.env.PGLITE_MODULE).href:'@electric-sql/pglite');
const db=await PGlite.create();
const read=name=>readFile(new URL('../'+name,import.meta.url),'utf8');
const q=async(sql,params=[]) => (await db.query(sql,params)).rows;
const uid=id=>`00000000-0000-0000-0000-${String(id).padStart(12,'0')}`;
const month='2026-08',start='2026-07-21',end='2026-08-20';
async function actor(employee,role='authenticated'){
  await db.exec('reset role');await q("select set_config('request.jwt.claim.sub',$1,false)",[employee?uid(employee):'']);
  await db.exec('set role '+role);
}
async function owner(employee=1){await actor(employee,'postgres');}
const source=async()=> (await q('select public.admin_driving_report_csv_source($1::date) data',[month+'-01']))[0].data;
const context=vm.createContext({window:{},Blob,TextEncoder});
vm.runInContext(await read('driving-report-period.js'),context);context.DrivingReportPeriod=context.window.DrivingReportPeriod;
vm.runInContext(await read('driving-report-csv.js'),context);const csv=context.window.DrivingReportCsv;
const exportId='12345678-1234-4123-8123-123456789abc';
const asCsv=data=>csv.build(csv.parseSource(JSON.stringify(data)),month,exportId);
let passed=0;
async function test(name,fn){await fn();passed++;console.log('PASS DB '+name);}
try{
  console.log((await q('select version() v'))[0].v);
  await db.exec(`
    create role authenticated;create role anon;create role service_role;create role csv_limited_owner;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema auth to authenticated,anon,csv_limited_owner;
    create table public.employees(id bigint primary key,auth_user_id uuid,active boolean,admin_scope text,name text,department text,attendance_required boolean);
    create table public.sites(id bigint primary key,display_name text);
    create function public.current_employee_id() returns bigint language sql stable security definer set search_path='' as $$
      select id from public.employees where auth_user_id=auth.uid() and active$$;
    create function public.is_application_admin() returns boolean language sql stable security definer set search_path='' as $$
      select exists(select 1 from public.employees where auth_user_id=auth.uid() and active and admin_scope='all')$$;
    grant select on public.employees to authenticated;
    alter table public.employees enable row level security;
    create policy own_employee on public.employees for select to authenticated using(id=public.current_employee_id());
    insert into public.employees select n,('00000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,true,
      case when n=1 then 'all' when n=34 then 'department' else 'none' end,'社員'||n,'工事部',true from generate_series(1,34) n;
    create table public.applications(id bigint primary key,employee_id bigint references public.employees(id),application_type text,status text);
    alter table public.applications enable row level security;
    create policy own_application on public.applications for select to authenticated using(employee_id=public.current_employee_id());
    grant select on public.applications to authenticated;
  `);
  for(const file of ['create_driving_report_tables.sql','add_driving_report_submission.sql','add_driving_report_destination.sql','add_pre_drive_alcohol_checks.sql'])await db.exec(await read('supabase/'+file));
  // Real month table/constraints/RLS/GRANT block; unrelated submission/gate logic
  // is outside this read-RPC test. Base daily validators/triggers above are real.
  const monthly=await read('supabase/add_driving_report_month_submission.sql');
  await db.exec(monthly.slice(0,monthly.indexOf('-- Per employee/closing-month'))+'commit;');
  // Only this column's type is needed; no vehicle-management fixture functions.
  await db.exec(`alter table public.driving_reports add column vehicle_name_snapshot text;
    create table public.fuel_receipts(report_id bigint references public.driving_reports(id),state text);
    alter table public.fuel_receipts enable row level security;
    create policy no_receipts on public.fuel_receipts for select to authenticated using(false);
    grant select on public.fuel_receipts to authenticated;
    insert into public.vehicles(vehicle_number,vehicle_name) select 'CAR-'||n,'車両'||n from generate_series(1,31)n;
  `);
  const written=new Map();
  async function report(employee,date,car,{submitted=true,meter='1000.0',fuel=[]}={}){
    await owner(employee);
    const r=(await q(`insert into public.driving_reports(employee_id,report_date,driving_status,vehicle_id,
      outbound_route_type,return_route_type,start_odometer,end_odometer)
      values($1,$2,$3,$4,$5,$6,$7,$8) returning id`,[employee,date,car?'driven':'no_driving',car,car?'office':null,car?'office':null,car?meter:null,car?String(Number(meter)+20):null]))[0].id;
    if(car){
      await q(`insert into public.driving_report_inspections(driving_report_id,inspection_item_code,result,checked_at)
        select $1,inspection_item_code,'ok',$2::timestamptz from public.driving_report_inspection_items()`,[r,date+'T08:00:00+09:00']);
      for(const type of ['commute_before','return_before'])await q(`insert into public.driving_alcohol_checks(driving_report_id,check_type,checked_at,alcohol_value,phone_confirmed,confirmed_by_name_snapshot)
        values($1,$2,$3,0,false,'中尾')`,[r,type,date+'T08:00:00+09:00']);
    }
    for(const f of fuel){const saved=(await q(`insert into public.driving_refuels(driving_report_id,refueled_at,liters,odometer_km)
      values($1,$2,$3,$4) returning id`,[r,f.at||date+'T00:00:00+09:00',f.liters||'10.125',f.meter===undefined?meter:f.meter]))[0].id;f.id=saved;}
    if(submitted)await q('select public.submit_driving_report($1)',[r]);return r;
  }
  function days(closing,records){
    const span=context.DrivingReportPeriod.range(closing);
    return span.days.map(date=>({date,calendar:'休日',required:records.has(date),reason:records.has(date)?'calendar_workday':'company_holiday',report_id:records.get(date)||null,status:records.has(date)?'draft':null,
      issue:null,attendance:null,leave_application_id:null,holiday_work_record_ids:[]}));
  }
  async function submitMonth(employee,closing,records,leave=false){
    await owner(employee);const span=context.DrivingReportPeriod.range(closing),ds=days(closing,records);
    if(leave){
      await q(`insert into public.applications values($1,$2,'paid_leave','approved'),($3,$2,'comp_leave','approved')`,[employee*100,employee,employee*100+1]);
      Object.assign(ds[2],{reason:'approved_full_leave',leave_application_id:employee*100});Object.assign(ds[3],{reason:'approved_full_leave',leave_application_id:employee*100+1});
    }
    return (await q(`insert into public.driving_report_month_submissions(employee_id,closing_month,period_start,period_end,submitted_by,snapshot)
      values($1,$2,$3,$4,$1,$5) returning id`,[employee,closing+'-01',span.start,span.end,JSON.stringify({closing_month:closing+'-01',period_start:span.start,period_end:span.end,valid:true,errors:[],days:ds})]))[0].id;
  }
  for(let employee=2;employee<=31;employee++){
    const car=employee-1;
    const driven=await report(employee,start,car,{fuel:[{meter:'1005.0'},{meter:'1010.0'}]});
    const none=await report(employee,'2026-07-22',null);
    const records=new Map([[start,driven],['2026-07-22',none]]);written.set(employee,records);
    if(employee===2)records.set('2026-07-25',await report(employee,'2026-07-25',31,{meter:'2000.0',fuel:[{meter:'2010.0'}]}));
    await submitMonth(employee,month,records,true);
  }
  // Non-submitter and non-driving employee remain roster candidates, never official.
  await report(32,start,1);
  // Prior vehicle 1 was used by another employee: must not filter by current driver.
  const old1=await report(3,'2026-07-19',1,{meter:'900.0',fuel:[{meter:'900.0'}]});
  await submitMonth(3,'2026-07',new Map([['2026-07-19',old1]]));
  const old2=await report(4,'2026-07-20',2,{meter:'800.0',fuel:[{meter:'800.0'},{meter:'810.0'}]});
  await submitMonth(4,'2026-07',new Map([['2026-07-20',old2]]));
  const old3=await report(5,'2026-07-20',3,{meter:'700.0',fuel:[{meter:null}]});
  await submitMonth(5,'2026-07',new Map([['2026-07-20',old3]]));
  // Newer unsubmitted refuel on vehicle 1 must not become a formal baseline.
  await report(32,'2026-07-20',1,{submitted:false,meter:'950.0',fuel:[{meter:'950.0'}]});
  // Many older refuels: response must stay bounded, without truncating chronology.
  const older=await report(6,'2026-07-18',4,{meter:'400.0',fuel:Array.from({length:200},(_,i)=>({meter:String(400+i/10)}))});
  await submitMonth(6,'2026-07',new Map([['2026-07-18',older]]));
  await owner();
  const security=async()=>q(`select c.relname,c.relacl::text,
    (select jsonb_agg(to_jsonb(p) order by policyname) from pg_policies p where p.schemaname='public' and p.tablename=c.relname) as policies
    from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' order by c.relname`);
  const securityBefore=await security();
  const sql=await read('supabase/add_driving_report_csv_export.sql');await db.exec(sql);
  const before=(await q(`select jsonb_build_object(
    'reports',(select jsonb_agg(to_jsonb(r) order by id) from public.driving_reports r),
    'refuels',(select jsonb_agg(to_jsonb(f) order by id) from public.driving_refuels f),
    'months',(select jsonb_agg(to_jsonb(m) order by id) from public.driving_report_month_submissions m)) data`))[0].data;
  await test('管理者・約30人・車両変更・CSV/ZIPまで実行',async()=>{
    await actor(1);const data=await source();assert.equal(data.submissions.length,30);assert.equal(data.reports.length,61);
    const result=asCsv(data);assert.equal(result.daily.length,930);assert.equal(result.fuel.length,61);assert.equal(result.previous.length,31);
    assert.equal(result.daily.find(r=>r.employee_id==='2'&&r.report_date==='2026-07-25').vehicle_id,'31');
    const zip=new Uint8Array(await csv.zip(result.files).arrayBuffer());assert.equal(new DataView(zip.buffer).getUint32(0,true),0x04034b50);
  });
  await test('差分適用で既存RLS・テーブルGRANTを変更しない',async()=>{
    await owner();assert.deepEqual(await security(),securityBefore);
  });
  await test('READ ONLYトランザクションで出力可能',async()=>{
    await actor(1);await db.exec('begin read only');try{assert.equal((await source()).submissions.length,30);}finally{await db.exec('rollback');}
  });
  await test('一般社員・部署管理者・anon・service_role実行拒否',async()=>{
    for(const [id,role] of [[2,'authenticated'],[34,'authenticated'],[null,'anon'],[1,'service_role']]){
      await actor(id,role);await assert.rejects(source,/admin_required|permission denied/);
    }
  });
  await test('既存RLSがマスタ・休暇・給油を隠しても全体管理者は完全取得',async()=>{
    await actor(1);assert.equal((await q('select count(*) n from public.employees'))[0].n,1);
    assert.equal((await q('select count(*) n from public.applications'))[0].n,0);
    const data=await source();assert.equal(data.employees.length,34);assert.equal(data.leave_applications.length,60);
    assert.equal(data.refuels.length,61);assert.equal(data.inspections.length,31*13);
  });
  await test('RLSで全月別提出を不可視にしても0人と誤認しない',async()=>{
    await owner();await db.exec('create policy hide_months on public.driving_report_month_submissions as restrictive for select to authenticated using(false)');
    await actor(1);assert.equal((await q('select count(*) n from public.driving_report_month_submissions'))[0].n,0);
    assert.equal((await source()).submissions.length,30);
  });
  await test('SELECT権限剥奪も通常社員のGRANTを広げずに対応',async()=>{
    await owner();await db.exec('revoke select on public.driving_refuels from authenticated');await actor(1);
    await assert.rejects(()=>q('select * from public.driving_refuels'),/permission denied/);assert.equal((await source()).refuels.length,61);
  });
  await test('関数所有者が無条件読取できない場合はエラー・0件にしない',async()=>{
    await owner();await db.exec(`grant usage on schema public to csv_limited_owner;
      grant select on all tables in schema public to csv_limited_owner;
      grant execute on function public.is_application_admin() to csv_limited_owner;
      alter function public.admin_driving_report_csv_source(date) owner to csv_limited_owner;`);
    await actor(1);await assert.rejects(source,/row-level security/);
    await owner();await db.exec('alter function public.admin_driving_report_csv_source(date) owner to postgres');
  });
  await test('所有者SELECT不足時もfail closed',async()=>{
    await owner();await db.exec('alter role csv_limited_owner bypassrls; revoke select on public.employees from csv_limited_owner; alter function public.admin_driving_report_csv_source(date) owner to csv_limited_owner');
    await actor(1);await assert.rejects(source,/permission denied/);
    await owner();await db.exec('alter function public.admin_driving_report_csv_source(date) owner to postgres; alter role csv_limited_owner nobypassrls');
  });
  await test('履歴あり・なし・下書き・同時刻複数・メーターNULL・200件履歴を集約',async()=>{
    await actor(1);const data=await source(),out=asCsv(data);assert(data.history.length<=2*31);
    const get=car=>out.previous.find(r=>r.vehicle_id===String(car));
    assert.equal(get(1).previous_refuel_status,'unconfirmed_history');assert.equal(get(1).previous_odometer_km,'900.0');
    assert.equal(get(2).previous_refuel_status,'order_unconfirmed');assert.equal(get(2).same_timestamp_candidate_count,'2');
    assert.equal(get(3).previous_refuel_status,'needs_review');assert.equal(get(4).same_timestamp_candidate_count,'200');
    assert.equal(get(31).previous_refuel_status,'no_history');assert.equal(get(31).previous_refuel_id,'');
  });
  await test('未提出・非運転対象を正式社員集合へ混入しない',async()=>{
    await actor(1);const result=asCsv(await source());assert(!result.submittedEmployeeIds.includes('32'));assert(!result.submittedEmployeeIds.includes('33'));
    assert(result.employees.some(e=>String(e.id)==='33'));assert.equal(result.submittedEmployeeIds.length,30);
  });
  await test('会社休日・有給・代休・運転なしを実DB応答から区別',async()=>{
    await actor(1);const result=asCsv(await source()),rows=result.daily.filter(r=>r.employee_id==='2');
    assert.equal(rows[1].day_state,'no_driving');assert.equal(rows[2].leave_type,'有給');assert.equal(rows[3].leave_type,'代休');assert.equal(rows.at(-1).day_state,'exempt_company_holiday');
  });
  await test('再出力の元データ同一・業務テーブル無変更',async()=>{
    await actor(1);const a=await source(),b=await source();delete a.exported_at;delete b.exported_at;assert.deepEqual(a,b);
    await owner();const after=(await q(`select jsonb_build_object(
      'reports',(select jsonb_agg(to_jsonb(r) order by id) from public.driving_reports r),
      'refuels',(select jsonb_agg(to_jsonb(f) order by id) from public.driving_refuels f),
      'months',(select jsonb_agg(to_jsonb(m) order by id) from public.driving_report_month_submissions m)) data`))[0].data;
    assert.deepEqual(after,before);
  });
  await test('関数のSTABLE・検索パス・RLS設定・公開権限',async()=>{
    const info=(await q(`select prosecdef,provolatile,proconfig from pg_proc where oid='public.admin_driving_report_csv_source(date)'::regprocedure`))[0];
    assert.equal(info.prosecdef,true);assert.equal(info.provolatile,'s');assert(info.proconfig.includes('row_security=off'));
    assert.equal((await q("select has_function_privilege('anon','public.admin_driving_report_csv_source(date)','EXECUTE') ok"))[0].ok,false);
  });
  await test('本番向け事前確認SQLを隔離DBで構文・READ ONLY検証',async()=>{
    await owner();const checks=await db.exec(await read('supabase/driving_report_csv_export_preflight.sql'));
    assert.equal(checks.flatMap(r=>r.rows||[]).find(r=>r.read_only)?.read_only,'on');
    assert.equal((await q("select current_setting('transaction_read_only') value"))[0].value,'off');
  });
  // Development draft endpoint: use the same isolated fixtures / real tables,
  // without modifying the production/official endpoint's code or predicates.
  const draftDates=['2026-08-21','2026-08-24','2026-08-25','2026-08-26','2026-08-27'],draftRecords=new Map();
  await owner();await q(`insert into public.employees values(39,$1,true,'none','テスト太郎','工事部',false)`,[uid(39)]);
  for(const date of draftDates)draftRecords.set(date,await report(39,date,1,{submitted:false}));
  await owner(39);await q('delete from public.driving_report_inspections where driving_report_id=$1',[draftRecords.get(draftDates[0])]);
  await owner();const formalDefinition=(await q("select pg_get_functiondef('public.admin_driving_report_csv_source(date)'::regprocedure) value"))[0].value;
  await db.exec(await read('supabase/add_driving_report_draft_test_export.sql'));
  const draftSource=async()=> (await q('select public.admin_driving_report_draft_test_source() data'))[0].data;
  await test('開発下書きRPCは管理者へ保存5行・給油0件をREAD ONLYで返す',async()=>{
    await actor(1);await db.exec('begin read only');
    try{
      const d=await draftSource();assert.equal(d.reports.length,5);assert.equal(d.refuels.length,0);
      assert(d.reports.every(r=>r.status==='draft'&&String(r.employee_id)==='39'));
      const out=csv.buildDraftTest(csv.parseSource(JSON.stringify(d)),exportId);assert.equal(out.daily.length,5);assert.equal(out.fuel.length,0);
      assert.equal(out.previous[0].previous_refuel_status,'unverified');assert.equal(out.daily[0].month_submission_id,'');assert.equal(out.daily[0].export_kind,'TEST_DRAFT');
      assert.throws(()=>csv.build(csv.parseSource(JSON.stringify(d)),'2026-09',exportId),/読取RPC/);
    }finally{await db.exec('rollback');}
    await owner();assert.equal((await q("select pg_get_functiondef('public.admin_driving_report_csv_source(date)'::regprocedure) value"))[0].value,formalDefinition);
  });
  await test('下書きRPCも本人39・一般社員・部署管理者・anonを拒否',async()=>{
    for(const [id,role] of [[39,'authenticated'],[2,'authenticated'],[34,'authenticated'],[null,'anon']]){
      await actor(id,role);await assert.rejects(draftSource,/admin_required|permission denied/);
    }
  });
  await test('5日すべてが下書きでなくなれば検証出力を停止',async()=>{
    await owner(39);await q('select public.submit_driving_report($1)',[draftRecords.get('2026-08-24')]);
    await actor(1);await assert.rejects(draftSource,/expected_five_saved_drafts/);
  });
  await test('月別提出済みになれば検証専用RPCを拒否',async()=>{
    await submitMonth(39,'2026-09',draftRecords);await actor(1);await assert.rejects(draftSource,/test_month_already_submitted/);
  });
  console.log(`DB tests: ${passed} groups passed (fresh isolated PGlite; production catalog not assumed).`);
}finally{await db.close();}
