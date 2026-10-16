// Isolated PGlite. Does not connect to production. PGLITE_MODULE may point to dist/index.js.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
const { PGlite } = await import(process.env.PGLITE_MODULE ? pathToFileURL(process.env.PGLITE_MODULE).href : '@electric-sql/pglite');
const db = await PGlite.create();
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
    create role authenticated; create role anon;
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
  await test('existing duplicates abort migration without cleanup', async () => {
    await db.exec('update employees set default_vehicle_id=1 where id in(2,3)');
    await assert.rejects(() => db.exec(migration), /duplicate_default_vehicle_assignments/);
    await db.exec('rollback');
    assert.equal((await q('select count(*)::int n from employees where default_vehicle_id=1'))[0].n, 2);
    await db.exec('update employees set default_vehicle_id=null');
  });
  const policies = await q("select * from pg_policies where tablename='employees'");
  await test('migration syntax / uniqueness / existing permissions preserved', async () => {
    await db.exec(migration);
    assert.deepEqual(await q("select * from pg_policies where tablename='employees'"), policies);
    assert.equal((await q("select has_table_privilege('authenticated','employees','UPDATE') allowed"))[0].allowed, false);
  });
  await test('whole migration reruns with identical UNIQUE without replacing constraint', async () => {
    const before = await q("select oid from pg_constraint where conrelid='employees'::regclass and conname='employees_default_vehicle_unique'");
    await db.exec(migration);
    assert.deepEqual(await q("select oid from pg_constraint where conrelid='employees'::regclass and conname='employees_default_vehicle_unique'"), before);
  });
  await test('same-name wrong column / deferred / INCLUDE / NULLS NOT DISTINCT definitions rejected', async () => {
    for (const definition of ['unique(auth_user_id)', 'unique(default_vehicle_id) deferrable',
      'unique(default_vehicle_id) include(id)', 'unique nulls not distinct(default_vehicle_id)']) {
      await db.exec('begin;alter table employees drop constraint employees_default_vehicle_unique');
      if (definition.includes('not distinct')) {
        await db.exec("insert into vehicles(id,vehicle_number,vehicle_name) overriding system value values(4,'test4','test4');update employees set default_vehicle_id=id");
      }
      await db.exec('alter table employees add constraint employees_default_vehicle_unique ' + definition);
      await assert.rejects(() => db.exec(migration), /employees_default_vehicle_unique_definition_mismatch/);
      await db.exec('rollback');
      assert.equal((await q("select condeferrable from pg_constraint where conrelid='employees'::regclass and conname='employees_default_vehicle_unique'"))[0].condeferrable, false);
    }
  });
  await actor(2);
  await q('select set_my_default_vehicle(1)');
  await actor(3);
  await test('self RPC duplicate rejected / setting unchanged', async () => {
    await fail('select set_my_default_vehicle(1)', /vehicle_already_assigned/);
    assert.equal((await q('select default_vehicle_id from employees where id=3'))[0].default_vehicle_id, null);
    await q('select set_my_default_vehicle(2)');
  });
  await test('ordinary user cannot use admin RPCs or direct employee updates', async () => {
    await fail('select admin_get_vehicle_master()', /application_admin_required/);
    await fail("select admin_save_vehicle_master('{}','[]','[]')", /application_admin_required/);
    await fail('update employees set default_vehicle_id=1 where id=3', /permission denied/);
  });
  await actor(1);
  await test('snapshot reflects latest self-setting changes', async () => {
    const s = await snapshot();
    assert.equal(s.employees.find(e => e.id === 2).default_vehicle_id, 1);
    assert.equal(s.employees.find(e => e.id === 3).default_vehicle_id, 2);
    assert.equal(s.vehicles.length, 3);
  });
  const vehicle = async id => (await snapshot()).vehicles.find(v => v.id === id);
  const payload = async id => { const v = await vehicle(id); return { ...v, expected_updated_at: v.updated_at }; };
  const protectedBefore = await q("select to_jsonb(e)-'default_vehicle_id' original from employees e order by id");
  await actor(2);
  await q("insert into driving_reports(employee_id,report_date,driving_status,vehicle_id) values(2,'2026-10-01','driven',1)");
  await db.exec('reset role');
  const reports = await q('select to_jsonb(r) row from driving_reports r');
  await actor(1);
  await test('employee swap atomically clears/reassigns both under immediate unique constraint', async () => {
    await save(await payload(1), [{ employee_id: 2, vehicle_id: 2 }, { employee_id: 3, vehicle_id: 'saved' }]);
    const s = await snapshot();
    assert.equal(s.employees.find(e => e.id === 2).default_vehicle_id, 2);
    assert.equal(s.employees.find(e => e.id === 3).default_vehicle_id, 1);
  });
  await test('partial swap conflict rolls back vehicle and all employee changes', async () => {
    const before = await snapshot();
    await assert.rejects(() => save({ ...(before.vehicles.find(v => v.id === 1)), expected_updated_at: before.vehicles.find(v => v.id === 1).updated_at, note: 'must roll back' },
      [{ employee_id: 2, vehicle_id: 'saved' }]), /vehicle_number_or_assignment_conflict/);
    assert.deepEqual(await snapshot(), before);
  });
  await test('replacement creates new car, assigns employee and disables old car together', async () => {
    const id = await save({ vehicle_number: '名古屋 400 あ 22-22', vehicle_name: '新車', active: true },
      [{ employee_id: 2, vehicle_id: 'saved' }], [2]);
    const s = await snapshot();
    assert.equal(s.employees.find(e => e.id === 2).default_vehicle_id, id);
    assert.equal(s.vehicles.find(v => v.id === 2).active, false);
  });
  await test('stale assignment snapshot detects employee self-setting changes', async () => {
    const old = await snapshot(); await actor(3); await q('select set_my_default_vehicle(null)'); await actor(1);
    await assert.rejects(() => save(awaitPayload(old.vehicles[0]), [], [], old.assignments), /vehicle_assignments_changed/);
  });
  function awaitPayload(v) { return { ...v, expected_updated_at: v.updated_at }; }
  await test('metadata stale version rejected', async () => {
    const old = await payload(1); await save({ ...old, note: 'updated' });
    await assert.rejects(() => save({ ...old, note: 'stale' }), /vehicle_changed/);
  });
  await test('duplicate plate / bad fields / inactive assignments / duplicate employees rejected atomically', async () => {
    const s = await snapshot();
    await assert.rejects(() => save({ vehicle_number: s.vehicles[0].vehicle_number, vehicle_name: '重複', active: true }), /vehicle_number_or_assignment_conflict/);
    await assert.rejects(() => save({ vehicle_number: ' ', vehicle_name: 'x', active: true }), /invalid_vehicle_fields/);
    await assert.rejects(() => save(awaitPayload(s.vehicles[0]), [{ employee_id: 4, vehicle_id: 'saved' }]), /active_assignment_employee_required/);
    await assert.rejects(() => save(awaitPayload(s.vehicles[0]), [{ employee_id: 3, vehicle_id: 2 }]), /active_vehicle_required/);
    await assert.rejects(() => save(awaitPayload(s.vehicles[0]), [{ employee_id: 3, vehicle_id: null }, { employee_id: 3, vehicle_id: 1 }]), /duplicate_assignment_employee/);
    assert.deepEqual(await snapshot(), s);
  });
  await test('p_vehicle.active=false rejects remaining owner and rolls back all metadata', async () => {
    await actor(3); await q('select set_my_default_vehicle(1)'); await actor(1);
    const before = await snapshot();
    await assert.rejects(async () => save({ ...(await payload(1)), active: false, note: 'must roll back' }), /deactivated_vehicle_still_assigned/);
    assert.deepEqual(await snapshot(), before);
  });
  await test('p_deactivate_ids rejects remaining owner and rolls back new vehicle / other assignment', async () => {
    const before = await snapshot();
    await assert.rejects(() => save({ vehicle_number: '失敗新車', vehicle_name: '失敗', active: true },
      [{ employee_id: 1, vehicle_id: 'saved' }], [1]), /deactivated_vehicle_still_assigned/);
    assert.deepEqual(await snapshot(), before);
  });
  await test('clear owner and disable in same transaction / inactive self select refused', async () => {
    await save({ ...(await payload(1)), active: false }, [{ employee_id: 3, vehicle_id: null }]);
    const s = await snapshot();
    assert.equal(s.employees.find(e => e.id === 3).default_vehicle_id, null);
    assert.equal(s.vehicles.find(v => v.id === 1).active, false);
    await actor(3); await fail('select set_my_default_vehicle(1)', /active_vehicle_required/); await q('select set_my_default_vehicle(null)');
  });
  await db.exec('reset role');
  await test('UNIQUE protects even writers outside the RPC lock / reports and protected fields unchanged', async () => {
    await q('update employees set default_vehicle_id=3 where id=2');
    await fail('update employees set default_vehicle_id=3 where id=3', /unique constraint/);
    assert.deepEqual(await q("select to_jsonb(e)-'default_vehicle_id' original from employees e order by id"), protectedBefore);
    assert.deepEqual(await q('select to_jsonb(r) row from driving_reports r'), reports);
  });
  await actor(4);
  await test('inactive employee and anon denied / physical DELETE remains forbidden', async () => {
    await fail('select set_my_default_vehicle(3)', /active_employee_required/);
    await fail('select admin_get_vehicle_master()', /application_admin_required/);
    await actor(1, 'anon'); await fail('select admin_get_vehicle_master()', /permission denied/);
    await fail('select set_my_default_vehicle(3)', /permission denied/);
    await actor(1); await fail('delete from vehicles where id=1', /permission denied/);
  });
  console.log(`PASS ${count} groups. PGlite single connection; cross-session blocking requires a separate PostgreSQL concurrency check.`);
} finally { await db.close(); }
