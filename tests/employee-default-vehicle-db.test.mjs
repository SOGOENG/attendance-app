// Isolated PGlite only. PGLITE_MODULE may specify an installed dist/index.js.
// Employee RLS/grants below are fixtures, not a claim about production policies.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
const { PGlite } = await import(process.env.PGLITE_MODULE ? pathToFileURL(process.env.PGLITE_MODULE).href : '@electric-sql/pglite');
const db = await PGlite.create();
const migration = await readFile(new URL('../supabase/add_employee_default_vehicle.sql', import.meta.url), 'utf8');
const q = async (sql, params = []) => (await db.query(sql, params)).rows;
const fail = (sql, pattern) => assert.rejects(() => db.query(sql), pattern);
let groups = 0;
const test = async (name, fn) => { await fn(); groups++; console.log('PASS ' + name); };
const uid = id => `00000000-0000-0000-0000-${String(id).padStart(12, '0')}`;
async function actor(id, role = 'authenticated') {
  await db.exec('reset role');
  await q("select set_config('request.jwt.claim.sub',$1,false)", [id == null ? '' : uid(id)]);
  await db.exec('set role ' + role);
}
try {
  await db.exec(`
    create role authenticated; create role anon; create role service_role bypassrls;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as
      $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema auth to authenticated,anon,service_role;
    create table public.employees(id bigint primary key,auth_user_id uuid,active boolean,
      admin_scope text,name text,department text,job_title text,profile_email text,phone_number text);
    insert into public.employees values
      (1,'${uid(1)}',true,'none','社員A','工事部','担当','a@example.test','010'),
      (2,'${uid(2)}',true,'all','管理者','総務','管理','b@example.test','020'),
      (3,'${uid(3)}',false,'none','無効社員','工事部','担当',null,null),
      (4,null,true,'none','未紐付け','工事部','担当',null,null);
    create function public.current_employee_id() returns bigint language sql stable
      security definer set search_path='' as
      $$select id from public.employees where auth_user_id=auth.uid() and active=true limit 1$$;
    create function public.is_application_admin() returns boolean language sql stable
      security definer set search_path='' as
      $$select exists(select 1 from public.employees where id=public.current_employee_id() and admin_scope='all')$$;
    alter table public.employees enable row level security;
    create policy employee_read on public.employees for select to authenticated using(true);
    create policy admin_edit on public.employees for update to authenticated
      using(public.is_application_admin()) with check(public.is_application_admin());
    grant select,update on public.employees to authenticated;
    grant select,update on public.employees to service_role;
    create table public.vehicles(id bigint primary key,active boolean not null,vehicle_number text);
    insert into public.vehicles values (10,true,'V10'),(11,true,'V11'),(12,false,'V12');
    create table public.driving_reports(id bigint primary key,employee_id bigint,vehicle_id bigint,vehicle_number_snapshot text);
    insert into public.driving_reports values(1,1,11,'V11');
  `);
  const policies = await q("select * from pg_policies where tablename='employees' order by policyname");
  const acl = await q("select relacl::text from pg_class where oid='public.employees'::regclass");
  const original = await q('select to_jsonb(e) original from public.employees e order by id');
  const reports = await q('select * from public.driving_reports');
  await test('migration / nullable bigint FK / unchanged RLS and grants', async () => {
    await db.exec(migration);
    assert.deepEqual(await q("select * from pg_policies where tablename='employees' order by policyname"), policies);
    assert.deepEqual(await q("select relacl::text from pg_class where oid='public.employees'::regclass"), acl);
    assert.deepEqual(await q("select to_jsonb(e)-'default_vehicle_id' original from public.employees e order by id"), original);
    assert((await q('select default_vehicle_id from employees')).every(r => r.default_vehicle_id === null));
  });
  await actor(1);
  await test('self active selection changes only the new column', async () => {
    assert.equal((await q('select set_my_default_vehicle(10) saved'))[0].saved, 10);
    assert.equal((await q('select default_vehicle_id from employees where id=1'))[0].default_vehicle_id, 10);
    assert.equal((await q('select default_vehicle_id from employees where id=2'))[0].default_vehicle_id, null);
    assert.deepEqual(await q("select to_jsonb(e)-'default_vehicle_id' original from public.employees e order by id"), original);
  });
  await test('inactive/missing vehicles rejected without overwriting', async () => {
    await fail('select set_my_default_vehicle(12)', /active_vehicle_required/);
    await fail('select set_my_default_vehicle(999)', /active_vehicle_required/);
    assert.equal((await q('select default_vehicle_id from employees where id=1'))[0].default_vehicle_id, 10);
  });
  await test('NULL clears / vehicle can be changed / no employee-id argument', async () => {
    assert.equal((await q('select set_my_default_vehicle(null) saved'))[0].saved, null);
    await q('select set_my_default_vehicle(11)');
    await fail('select set_my_default_vehicle(2,10)', /does not exist/);
  });
  await test('ordinary direct employee/profile edits remain denied by existing RLS', async () => {
    assert.equal((await db.query("update employees set name='改ざん',department='改ざん',job_title='管理者',profile_email='x@example.test',phone_number='999' where id=1")).affectedRows, 0);
    assert.equal((await db.query('update employees set default_vehicle_id=10 where id=2')).affectedRows, 0);
  });
  await actor(2);
  await test('admin can set own preference / existing admin editing preserved', async () => {
    await q('select set_my_default_vehicle(10)');
    await db.exec("update employees set job_title='変更済み' where id=1");
    assert.equal((await q('select job_title from employees where id=1'))[0].job_title, '変更済み');
    assert.equal((await q('select default_vehicle_id from employees where id=1'))[0].default_vehicle_id, 11);
  });
  await actor(3);
  await test('inactive employee rejected including NULL clear', async () => {
    await fail('select set_my_default_vehicle(10)', /active_employee_required/);
    await fail('select set_my_default_vehicle(null)', /active_employee_required/);
  });
  await actor(4);
  await test('unlinked Auth rejected', async () => { await fail('select set_my_default_vehicle(10)', /active_employee_required/); });
  await actor(null);
  await test('missing Auth rejected', async () => { await fail('select set_my_default_vehicle(null)', /active_employee_required/); });
  await actor(1, 'anon');
  await test('anon EXECUTE denied even with a claimed identity', async () => { await fail('select set_my_default_vehicle(10)', /permission denied/); });
  await db.exec('reset role');
  await test('PUBLIC EXECUTE revoked / secure fixed search_path', async () => {
    assert.equal((await q("select has_function_privilege('anon','public.set_my_default_vehicle(bigint)','EXECUTE') allowed"))[0].allowed, false);
    const f = (await q("select prosecdef,proconfig,proacl::text acl from pg_proc where oid='public.set_my_default_vehicle(bigint)'::regprocedure"))[0];
    assert.equal(f.prosecdef, true); assert(f.proconfig.some(s => s.startsWith('search_path=')));
    assert(!/[{,]=X\//.test(f.acl));
  });
  await test('deactivation preserves FK / setting inactive again rejected / clear allowed', async () => {
    await db.exec('update vehicles set active=false where id=11');
    await actor(1);
    assert.equal((await q('select default_vehicle_id from employees where id=1'))[0].default_vehicle_id, 11);
    await fail('select set_my_default_vehicle(11)', /active_vehicle_required/);
    await q('select set_my_default_vehicle(null)');
    await q('select set_my_default_vehicle(10)');
  });
  await db.exec('reset role');
  await test('FK rejects physical deletion / dangling references', async () => {
    await fail('delete from vehicles where id=10', /foreign key constraint/);
    await fail('update employees set default_vehicle_id=999 where id=1', /foreign key constraint/);
  });
  await actor(null, 'service_role');
  await test('service-role profile update stays independent', async () => {
    await db.exec("update employees set profile_email='new@example.test',phone_number='030' where id=1");
    const e = (await q('select * from employees where id=1'))[0];
    assert.equal(e.default_vehicle_id, 10); assert.equal(e.profile_email, 'new@example.test');
  });
  await db.exec('reset role');
  await test('historical reports untouched / migration collision safely stops', async () => {
    assert.deepEqual(await q('select * from public.driving_reports'), reports);
    await assert.rejects(() => db.exec(migration), /already exists/);
    await db.exec('rollback');
    assert.equal((await q('select default_vehicle_id from employees where id=1'))[0].default_vehicle_id, 10);
  });
  console.log(`PASS ${groups} groups; fixture RLS only, no production access.`);
} finally { await db.close(); }
