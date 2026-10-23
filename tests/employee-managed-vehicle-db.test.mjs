// PGlite by default. For real LOCAL PostgreSQL use POSTGRES_TEST_PORT and
// POSTGRES_MODULE=/path/to/postgres/src/index.js. Creates/drops its own test DB.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
let db;
if (process.env.POSTGRES_TEST_PORT) {
  const { default: postgres } = await import(process.env.POSTGRES_MODULE ? pathToFileURL(process.env.POSTGRES_MODULE).href : 'postgres');
  const port = Number(process.env.POSTGRES_TEST_PORT);
  assert(Number.isInteger(port) && port > 0 && port <= 65535);
  const options = { host: '127.0.0.1', port, user: 'postgres', max: 1, onnotice: () => {},
    types: { bigint: { to: 20, from: [20], serialize: String, parse: Number } } };
  const control = postgres({ ...options, database: 'postgres' });
  const database = 'employee_vehicle_review_' + process.pid + '_' + Date.now();
  await control.unsafe('create database ' + database);
  const client = postgres({ ...options, database });
  db = { query: async (sql, params = []) => ({ rows: await client.unsafe(sql, params) }),
    exec: sql => client.unsafe(sql).simple(), close: async () => {
      await client.end({ timeout: 2 });
      try { await control.unsafe('drop database ' + database); } finally { await control.end(); }
    } };
  console.log('Real PostgreSQL:', (await db.query('select version() v')).rows[0].v);
} else {
  const { PGlite } = await import(process.env.PGLITE_MODULE ? pathToFileURL(process.env.PGLITE_MODULE).href : '@electric-sql/pglite');
  db = await PGlite.create();
}
const read = name => readFile(new URL('../supabase/' + name, import.meta.url), 'utf8');
const q = async (sql, params = []) => (await db.query(sql, params)).rows;
const uid = id => `00000000-0000-0000-0000-${String(id).padStart(12, '0')}`;
async function actor(id, role = 'authenticated') {
  await db.exec('reset role');
  await q("select set_config('request.jwt.claim.sub',$1,false)", [uid(id)]);
  await db.exec('set role ' + role);
}
let count = 0;
async function test(name, fn) { await fn(); console.log('PASS ' + name); count++; }
const fail = (sql, re) => assert.rejects(() => db.query(sql), re);
const snapshot = async () => (await q('select admin_get_vehicle_master() data'))[0].data;
async function save(vehicle, assignments = [], deactivations = [], expected = null) {
  const snap = await snapshot();
  return (await q('select admin_save_vehicle_master($1,$2,$3,$4) id', [
    vehicle, assignments, expected || snap.assignments, deactivations
  ]))[0].id;
}
try {
  await db.exec(`
    do $$begin
      if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
      if not exists(select 1 from pg_roles where rolname='anon') then create role anon; end if;
    end$$;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as
      $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema auth to authenticated,anon;
    create table employees(id bigint primary key,auth_user_id uuid,active boolean,admin_scope text,
      name text,department text,job_title text,profile_email text,phone_number text);
    insert into employees values
      (1,'${uid(1)}',true,'all','管理者','総務','管理','a@example.test','010'),
      (2,'${uid(2)}',true,'none','社員B','工事部','担当','b@example.test','020'),
      (3,'${uid(3)}',true,'none','社員C','工事部','担当','c@example.test','030'),
      (4,'${uid(4)}',false,'none','無効社員','工事部','担当',null,null);
    create function current_employee_id() returns bigint language sql stable security definer set search_path='' as
      $$select id from public.employees where auth_user_id=auth.uid() and active limit 1$$;
    create function is_application_admin() returns boolean language sql stable security definer set search_path='' as
      $$select exists(select 1 from public.employees where id=public.current_employee_id() and admin_scope='all')$$;
    create table sites(id bigint primary key,display_name text);
    alter table employees enable row level security;
    create policy employee_read on employees for select to authenticated using(true);
    grant select on employees to authenticated;
  `);
  await db.exec(await read('create_driving_report_tables.sql'));
  await db.exec(await read('add_employee_default_vehicle.sql'));
  await db.exec("insert into vehicles(vehicle_number,vehicle_name) values('名古屋 400 あ 12-34','ハイエース'),('名古屋 400 あ 56-78','軽バン'),('名古屋 400 あ 90-12','予備登録')");
  const migration = await read('add_vehicle_master_management.sql');

  await db.exec(migration);
  await db.exec(await read('add_driving_report_submission.sql'));
  await actor(2); await q("insert into driving_reports(employee_id,report_date,driving_status,vehicle_id) values(2,'2026-10-01','driven',1)");
  await q("insert into driving_reports(employee_id,report_date,driving_status) values(2,'2026-09-30','no_driving')");
  await q("select submit_driving_report(id) from driving_reports where report_date='2026-09-30'");
  await db.exec('reset role');
  const historical=await q('select to_jsonb(r) row from driving_reports r');
  const policyBefore = await q("select * from pg_policies where schemaname='public' order by tablename,policyname");
  const grantsBefore = await q("select relname,relacl::text acl from pg_class where oid in ('employees'::regclass,'vehicles'::regclass,'driving_reports'::regclass) order by relname");
  const prepareBefore = await q("select pg_get_functiondef('driving_report_prepare()'::regprocedure) def");
  const readMigration = await read('add_employee_managed_vehicle.sql');
  await test('disabled base trigger is rejected atomically before schema change',async()=>{
    await db.exec('begin;alter table driving_reports disable trigger driving_report_prepare');
    await assert.rejects(()=>db.exec(readMigration),/driving_report_prepare_trigger_incompatible/);
    await db.exec('rollback');
  });
  await test('new migration adds nullable name without updating historical data',async()=>{
    await db.exec(readMigration);
    assert.deepEqual(await q("select to_jsonb(r)-'vehicle_name_snapshot' row from driving_reports r"),historical);
    assert.equal((await q('select vehicle_name_snapshot from driving_reports'))[0].vehicle_name_snapshot,null);
  });
  await test('base function, RLS and table grants unchanged / trigger order and private execution',async()=>{
    assert.deepEqual(await q("select * from pg_policies where schemaname='public' order by tablename,policyname"),policyBefore);
    assert.deepEqual(await q("select relname,relacl::text acl from pg_class where oid in ('employees'::regclass,'vehicles'::regclass,'driving_reports'::regclass) order by relname"),grantsBefore);
    assert.deepEqual(await q("select pg_get_functiondef('driving_report_prepare()'::regprocedure) def"),prepareBefore);
    assert.deepEqual((await q("select tgname from pg_trigger where tgrelid='driving_reports'::regclass and not tgisinternal order by tgname")).map(r=>r.tgname),['driving_report_prepare','driving_report_vehicle_snapshot_prepare']);
    for(const role of ['authenticated','anon']) assert.equal((await q("select has_function_privilege($1,'driving_report_vehicle_snapshot_prepare()','EXECUTE') allowed",[role]))[0].allowed,false);
  });
  const register=async(id,number,name,source=null,expected=null)=>{
    const s=await snapshot();return (await q('select admin_set_employee_managed_vehicle($1,$2,$3,$4,$5) id',[id,number,name,expected||s.assignments,source]))[0].id;
  };
  await actor(3);await q('select set_my_default_vehicle(3)');
  await actor(1);let first,second;
  await test('direct employee registration / profile fields untouched',async()=>{
    assert.equal((await q("select count(*)::int n from vehicles where vehicle_number='名古屋 400 あ 11-11'"))[0].n,0);
    first=await register(2,'名古屋 400 あ 11-11','管理車両A');
    const s=await snapshot();assert.equal(s.employees.find(e=>e.id===2).default_vehicle_id,first);
    assert.equal(s.vehicles.find(v=>v.id===first).vehicle_number,'名古屋 400 あ 11-11');
  });
  await test('existing same-number same-name registration is idempotent and keeps other owners',async()=>{
    const before=await snapshot();
    const id=await register(2,'名古屋 400 あ 11-11','管理車両A');assert.equal(id,first);
    const after=await snapshot();assert.equal(after.vehicles.length,before.vehicles.length);
    assert.deepEqual(after.assignments,before.assignments);
  });
  await actor(2);
  await test('new report stores both snapshots in DB and ignores client snapshots',async()=>{
    await q("insert into driving_reports(employee_id,report_date,driving_status,vehicle_id,vehicle_number_snapshot,vehicle_name_snapshot) values(2,'2026-10-02','driven',$1,'偽番号','偽名')",[first]);
    const r=(await q("select * from driving_reports where report_date='2026-10-02'"))[0];
    assert.equal(r.vehicle_number_snapshot,'名古屋 400 あ 11-11');assert.equal(r.vehicle_name_snapshot,'管理車両A');
  });
  await db.exec('reset role');const beforeReplacement=await q('select to_jsonb(r) row from driving_reports r order by id');await actor(1);
  await test('replacement inserts a new car and retains old car and all reports',async()=>{
    second=await register(2,'名古屋 400 あ 22-22','管理車両B');assert.notEqual(first,second);
    const s=await snapshot();assert.equal(s.vehicles.find(v=>v.id===first).active,false);assert.equal(s.vehicles.find(v=>v.id===first).vehicle_name,'管理車両A');
    assert.equal(s.employees.find(e=>e.id===2).default_vehicle_id,second);
    assert.equal(s.employees.find(e=>e.id===3).default_vehicle_id,3);
    assert.equal(s.vehicles.find(v=>v.id===3).active,true);
  });
  await test('transfer requires explicit current source acknowledgement',async()=>{
    const s=await snapshot();await assert.rejects(()=>register(3,'名古屋 400 あ 22-22','管理車両B'),/managed_vehicle_source_changed/);
    assert.deepEqual(await snapshot(),s);
    const moved=await register(3,'名古屋 400 あ 22-22','管理車両B',2);assert.equal(moved,second);
    const after=await snapshot();assert.equal(after.employees.find(e=>e.id===2).default_vehicle_id,null);assert.equal(after.employees.find(e=>e.id===3).default_vehicle_id,second);
  });
  await test('existing number with different name refuses relabeling / stale snapshot refuses changes',async()=>{
    const before=await snapshot();await assert.rejects(()=>register(2,'名古屋 400 あ 22-22','別名',3),/managed_vehicle_name_mismatch/);assert.deepEqual(await snapshot(),before);
    await actor(3);await q('select set_my_default_vehicle(null)');await actor(1);
    await assert.rejects(()=>register(2,'名古屋 400 あ 33-33','古い画面',null,before.assignments),/vehicle_assignments_changed/);
  });
  await test('inactive existing car can be reused without changing its identity',async()=>{
    const reused=await register(2,'名古屋 400 あ 11-11','管理車両A');assert.equal(reused,first);
    assert.equal((await snapshot()).vehicles.find(v=>v.id===first).active,true);
  });
  await db.exec('reset role');
  await test('replacement and transfer never update employee ownership of old reports',async()=>{
    assert.deepEqual(await q('select to_jsonb(r) row from driving_reports r order by id'),beforeReplacement);
  });
  await actor(2);
  await test('unrelated corrections preserve legacy NULL and immutable snapshots',async()=>{
    await q("update driving_reports set note='訂正',vehicle_name_snapshot='改ざん' where report_date='2026-10-01'");
    assert.equal((await q("select vehicle_name_snapshot from driving_reports where report_date='2026-10-01'"))[0].vehicle_name_snapshot,null);
    await q("update driving_reports set note='訂正',vehicle_name_snapshot='改ざん' where report_date='2026-10-02'");
    assert.equal((await q("select vehicle_name_snapshot from driving_reports where report_date='2026-10-02'"))[0].vehicle_name_snapshot,'管理車両A');
  });
  await test('temporary report vehicle change updates snapshots, not employee default',async()=>{
    await q("update driving_reports set vehicle_id=$1 where report_date='2026-10-02'",[second]);
    const r=(await q("select * from driving_reports where report_date='2026-10-02'"))[0];assert.equal(r.vehicle_name_snapshot,'管理車両B');assert.equal(r.employee_id,2);
    assert.equal((await q('select default_vehicle_id from employees where id=2'))[0].default_vehicle_id,first);
  });
  await test('master label changes never refresh snapshots on unrelated report edits',async()=>{
    await actor(1);
    await q("update vehicles set vehicle_number='変更後番号',vehicle_name='変更後名称' where id=$1",[second]);
    await actor(2);
    await q("update driving_reports set note='マスタ変更後の訂正' where report_date='2026-10-02'");
    const r=(await q("select vehicle_number_snapshot,vehicle_name_snapshot from driving_reports where report_date='2026-10-02'"))[0];
    assert.equal(r.vehicle_number_snapshot,'名古屋 400 あ 22-22');assert.equal(r.vehicle_name_snapshot,'管理車両B');
    await actor(1);await q("update vehicles set vehicle_number='名古屋 400 あ 22-22',vehicle_name='管理車両B' where id=$1",[second]);await actor(2);
  });
  await test('existing submitted report correction retains first submission and lateness',async()=>{
    const before=(await q("select submitted_at,late_entry,late_entry_days from driving_reports where report_date='2026-09-30'"))[0];
    await q("update driving_reports set status='draft',note='訂正' where report_date='2026-09-30'");
    await q("select submit_driving_report(id) from driving_reports where report_date='2026-09-30'");
    assert.deepEqual((await q("select submitted_at,late_entry,late_entry_days from driving_reports where report_date='2026-09-30'"))[0],before);
  });
  await test('submitted driven report cannot change metadata, vehicle, snapshots or details',async()=>{
    await q("update driving_reports set outbound_route_type='office',return_route_type='direct',start_odometer=100,end_odometer=120 where report_date='2026-10-02'");
    const id=(await q("select id from driving_reports where report_date='2026-10-02'"))[0].id;
    await q("insert into driving_report_inspections(driving_report_id,inspection_item_code,result,checked_at) select $1,inspection_item_code,'ok',now() from driving_report_inspection_items()",[id]);
    await q("insert into driving_alcohol_checks(driving_report_id,check_type,checked_at,alcohol_value,confirmation_method,confirmed_by_name_snapshot) values($1,'before',now(),0,'対面','確認者'),($1,'after',now(),0,'対面','確認者')",[id]);
    await q('select submit_driving_report($1)',[id]);
    for(const mutation of ["note='変更'",'vehicle_id='+first,"vehicle_name_snapshot='偽名'",'submitted_at=null']) {
      await fail('update driving_reports set '+mutation+' where id='+id,/reopen_draft_before_correction/);
    }
    await fail("update driving_report_inspections set result='not_applicable' where driving_report_id="+id,/reopen_draft_before_correction/);
    assert.equal((await q('delete from driving_report_inspections where driving_report_id=$1 returning *',[id])).length,0);
  });
  await test('ordinary employee cannot register or transfer another employee car',async()=>{
    await assert.rejects(()=>register(3,'不正番号','不正車'),/application_admin_required/);
  });
  await actor(1);await test('bad fields / inactive employee rejected',async()=>{
    await assert.rejects(()=>register(2,' ','x'),/invalid_managed_vehicle_fields/);
    await assert.rejects(()=>register(4,'未登録','x'),/active_assignment_employee_required/);
  });

  await db.exec('reset role');
  const beforeDestination=await q('select to_jsonb(r) row from driving_reports r order by id');
  await test('destination migration preserves old reports and does not create sites',async()=>{
    const sitesBefore=await q('select * from sites order by id');
    await db.exec(await read('add_driving_report_destination.sql'));
    assert.deepEqual(await q("select to_jsonb(r)-'destination_text' row from driving_reports r order by id"),beforeDestination);
    assert.deepEqual(await q('select * from sites order by id'),sitesBefore);
    await q("insert into sites(id,display_name) values(1,'既存現場')");
  });
  await actor(2);
  await test('free destination draft, master switching, exclusivity and input bounds',async()=>{
    await q("insert into driving_reports(employee_id,report_date,driving_status,destination_text) values(2,'2026-10-05','driven','資材購入先')");
    await fail("update driving_reports set site_id=1 where report_date='2026-10-05'",/destination_exclusive/);
    await q("update driving_reports set site_id=1,destination_text=null where report_date='2026-10-05'");
    assert.equal((await q("select site_name_snapshot from driving_reports where report_date='2026-10-05'"))[0].site_name_snapshot,'既存現場');
    await q("update driving_reports set site_id=null,destination_text='自由行先' where report_date='2026-10-05'");
    await fail("update driving_reports set destination_text='   ' where report_date='2026-10-05'",/destination_text_valid/);
    await assert.rejects(()=>q("update driving_reports set destination_text=$1 where report_date='2026-10-05'",['x'.repeat(501)]),/destination_text_valid/);
  });
  await test('driven submission retains destination and routes / submitted editing rejected',async()=>{
    const id=(await q("select id from driving_reports where report_date='2026-10-05'"))[0].id;
    await q("update driving_reports set vehicle_id=$1,outbound_route_type='office',return_route_type='direct',start_odometer=1,end_odometer=2 where id=$2",[first,id]);
    await q("insert into driving_report_inspections(driving_report_id,inspection_item_code,result,checked_at) select $1,inspection_item_code,'ok',now() from driving_report_inspection_items()",[id]);
    await q("insert into driving_alcohol_checks(driving_report_id,check_type,checked_at,alcohol_value,confirmation_method,confirmed_by_name_snapshot) values($1,'before',now(),0,'対面','確認'),($1,'after',now(),0,'対面','確認')",[id]);
    await q('select submit_driving_report($1)',[id]);
    const r=(await q('select * from driving_reports where id=$1',[id]))[0];assert.equal(r.status,'submitted');assert.equal(r.destination_text,'自由行先');
    assert.equal(r.outbound_route_type,'office');assert.equal(r.return_route_type,'direct');
    await fail("update driving_reports set destination_text='改ざん' where id="+id,/reopen_draft_before_correction/);
  });
  await test('no_driving destination rejected at submission atomically',async()=>{
    await q("insert into driving_reports(employee_id,report_date,driving_status,destination_text) values(2,'2026-10-06','no_driving','未消去')");
    const id=(await q("select id from driving_reports where report_date='2026-10-06'"))[0].id;
    await fail('select submit_driving_report('+id+')',/no_driving_destination/);
    const r=(await q('select * from driving_reports where id=$1',[id]))[0];assert.equal(r.status,'draft');assert.equal(r.submitted_at,null);
    await q('update driving_reports set destination_text=null where id=$1',[id]);await q('select submit_driving_report($1)',[id]);
  });

  await actor(2);
  await q("insert into driving_reports(employee_id,report_date,driving_status) values(2,'2026-10-07','driven')");
  await db.exec('reset role');
  const oldAlcohol=await q('select to_jsonb(a) row from driving_alcohol_checks a order by id');
  const oldReports=await q('select to_jsonb(r) row from driving_reports r order by id');
  const oldPolicies=await q("select * from pg_policies order by tablename,policyname");
  const destinationConstraints=await q("select conname,pg_get_constraintdef(oid) definition from pg_constraint where conrelid='driving_reports'::regclass and conname like 'driving_reports_%destination%' order by conname");
  await test('new alcohol migration preserves legacy records, reports and RLS',async()=>{
    await db.exec(await read('add_pre_drive_alcohol_checks.sql'));
    assert.deepEqual(await q("select to_jsonb(a)-'phone_confirmed' row from driving_alcohol_checks a order by id"),oldAlcohol);
    assert.deepEqual(await q("select to_jsonb(r)-'alcohol_check_version' row from driving_reports r order by id"),oldReports);
    assert.deepEqual(await q('select * from pg_policies order by tablename,policyname'),oldPolicies);
    assert.deepEqual(await q("select conname,pg_get_constraintdef(oid) definition from pg_constraint where conrelid='driving_reports'::regclass and conname like 'driving_reports_%destination%' order by conname"),destinationConstraints);
  });
  await actor(2);
  await test('new validator rejects no-driving free destination before CHECK and allows cleared destination',async()=>{
    await q("insert into driving_reports(employee_id,report_date,driving_status,destination_text) values(2,'2026-10-10','no_driving','自由入力行先')");
    const id=(await q("select id from driving_reports where report_date='2026-10-10'"))[0].id;
    await fail('select submit_driving_report('+id+')',/no_driving_must_not_have_driving_data/);
    const r=(await q('select status,submitted_at from driving_reports where id=$1',[id]))[0];
    assert.equal(r.status,'draft');assert.equal(r.submitted_at,null);
    await q('update driving_reports set destination_text=null where id=$1',[id]);
    await q('select submit_driving_report($1)',[id]);
    assert.equal((await q('select status from driving_reports where id=$1',[id]))[0].status,'submitted');
  });
  await test('partial new checks upgrade legacy draft and reject downgrade / invalid confirmer',async()=>{
    const id=(await q("select id from driving_reports where report_date='2026-10-07'"))[0].id;
    await q("insert into driving_alcohol_checks(driving_report_id,check_type) values($1,'commute_before')",[id]);
    assert.equal((await q('select alcohol_check_version from driving_reports where id=$1',[id]))[0].alcohol_check_version,2);
    await fail('update driving_reports set alcohol_check_version=1 where id='+id,/alcohol_version_downgrade/);
    await fail("update driving_alcohol_checks set confirmed_by_name_snapshot='invalid' where driving_report_id="+id,/pre_drive_confirmer/);
  });
  await test('new submissions require both complete pre-drive checks; legacy after cannot substitute',async()=>{
    await q("insert into driving_reports(employee_id,report_date,driving_status,vehicle_id,outbound_route_type,return_route_type,start_odometer,end_odometer,alcohol_check_version,destination_text) values(2,'2026-10-08','driven',$1,'office','direct',10,20,1,'destination')",[first]);
    const id=(await q("select id from driving_reports where report_date='2026-10-08'"))[0].id;
    assert.equal((await q('select alcohol_check_version from driving_reports where id=$1',[id]))[0].alcohol_check_version,2);
    await q("insert into driving_report_inspections(driving_report_id,inspection_item_code,result,checked_at) select $1,inspection_item_code,'ok',now() from driving_report_inspection_items()",[id]);
    await q("insert into driving_alcohol_checks(driving_report_id,check_type,checked_at,alcohol_value,confirmation_method,confirmed_by_name_snapshot) values($1,'after',now(),0,'legacy','legacy')",[id]);
    await q("insert into driving_alcohol_checks(driving_report_id,check_type,checked_at,alcohol_value,phone_confirmed,confirmed_by_name_snapshot) values($1,'commute_before',now(),0,false,'中尾')",[id]);
    await fail('select submit_driving_report('+id+')',/both_pre_drive/);
    await q("insert into driving_alcohol_checks(driving_report_id,check_type) values($1,'return_before')",[id]);
    await fail('select submit_driving_report('+id+')',/both_pre_drive/);
    await q("update driving_alcohol_checks set checked_at=now(),alcohol_value=0,phone_confirmed=true,confirmed_by_name_snapshot='安藤' where driving_report_id=$1 and check_type='return_before'",[id]);
    for(const column of ['outbound_route_type','return_route_type','start_odometer','end_odometer']) {
      const original=(await q('select '+column+' value from driving_reports where id=$1',[id]))[0].value;
      await q('update driving_reports set '+column+'=null where id=$1',[id]);
      await fail('select submit_driving_report('+id+')',/driving_submission_fields_required/);
      await q('update driving_reports set '+column+'=$1 where id=$2',[original,id]);
    }
    await fail('update driving_reports set end_odometer=9 where id='+id,/check constraint "driving_reports_check"/);
    await q("delete from driving_report_inspections where driving_report_id=$1 and inspection_item_code='brake_horn'",[id]);
    await fail('select submit_driving_report('+id+')',/all_13_official_inspections_required/);
    await q("insert into driving_report_inspections(driving_report_id,inspection_item_code,result,checked_at) values($1,'brake_horn','ok',now())",[id]);
    for (const [column,restore] of [['checked_at','now()'],['alcohol_value','0'],['phone_confirmed','true'],['confirmed_by_name_snapshot',"'安藤'"]]) {
      await q('update driving_alcohol_checks set '+column+"=null where driving_report_id=$1 and check_type='return_before'",[id]);
      await fail('select submit_driving_report('+id+')',/both_pre_drive/);
      await q('update driving_alcohol_checks set '+column+'='+restore+" where driving_report_id=$1 and check_type='return_before'",[id]);
    }
    await q('select submit_driving_report($1)',[id]);
    assert.equal((await q('select destination_text from driving_reports where id=$1',[id]))[0].destination_text,'destination');
    const initial=(await q('select submitted_at,late_entry,late_entry_days from driving_reports where id=$1',[id]))[0];
    await fail("update driving_alcohol_checks set phone_confirmed=true where driving_report_id="+id,/reopen_draft/);
    await q("update driving_reports set status='draft' where id=$1",[id]);
    await q('select submit_driving_report($1)',[id]);
    assert.deepEqual((await q('select submitted_at,late_entry,late_entry_days from driving_reports where id=$1',[id]))[0],initial);
  });
  await test('legacy submitted history stays readable and new no-driving can submit',async()=>{
    assert.equal((await q("select alcohol_check_version from driving_reports where report_date='2026-10-02'"))[0].alcohol_check_version,1);
    await q("update driving_reports set status='draft' where report_date='2026-10-02'");
    await q("select submit_driving_report(id) from driving_reports where report_date='2026-10-02'");
    await q("insert into driving_reports(employee_id,report_date,driving_status) values(2,'2026-10-09','no_driving')");
    await q("select submit_driving_report(id) from driving_reports where report_date='2026-10-09'");
  });
  await actor(3);
  await test('other employee cannot change new alcohol rows',async()=>{
    assert.equal((await q("update driving_alcohol_checks set phone_confirmed=false returning id")).length,0);
  });
  await actor(1,'anon');await test('anon cannot execute new admin RPC or snapshot helper',async()=>{
    await fail("select admin_set_employee_managed_vehicle(2,'x','x','[]',null)",/permission denied/);
    await fail('select driving_report_vehicle_snapshot_prepare()',/permission denied/);
  });
  await test('safe registration guard preserves actual managed-vehicle RPC and historical reports',async()=>{
    await actor(1,'postgres');
    const reports=await q('select to_jsonb(r) r from public.driving_reports r order by id');
    await db.exec(`create role service_role;
      create table auth.users(id uuid primary key,email text,raw_app_meta_data jsonb,banned_until timestamptz,email_confirmed_at timestamptz);
      alter table public.employees add column is_leave_manager boolean not null default false,
       add column attendance_required boolean default true,add column improvement_required boolean default true,add column near_miss_required boolean default true;
      create table public.fuel_receipt_roles(employee_id bigint primary key);
      update public.employees set department='総務部' where id=1;`);
    await db.exec(await read('add_employee_management_rpc.sql'));
    await db.exec(await read('add_employee_creation_operations.sql'));
    await db.exec(await read('add_employee_safe_registration.sql'));
    await db.exec(await read('restrict_employee_direct_writes.sql'));
    await actor(1);
    const s=await snapshot();
    const car=(await q("select public.admin_set_employee_managed_vehicle(2,'SAFE-NEW','登録継続車両',$1,null) id",[s.assignments]))[0].id;
    assert.equal((await snapshot()).employees.find(e=>e.id===2).default_vehicle_id,car);
    await actor(1,'postgres');
    assert.deepEqual(await q('select to_jsonb(r) r from public.driving_reports r order by id'),reports);
  });
  console.log('PASS '+count+' employee-centered DB groups; no production access.');
} finally { await db.close(); }
