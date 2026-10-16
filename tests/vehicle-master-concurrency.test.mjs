// Requires a disposable LOCAL PostgreSQL server and postgres.js (not PGlite).
// POSTGRES_MODULE=/path/to/postgres/src/index.js POSTGRES_TEST_PORT=65439 node this-file
// Creates/drops only a uniquely named test database. Never reads production URLs.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
const { default: postgres } = await import(process.env.POSTGRES_MODULE ? pathToFileURL(process.env.POSTGRES_MODULE).href : 'postgres');
const port = Number(process.env.POSTGRES_TEST_PORT);
assert(Number.isInteger(port) && port > 0 && port <= 65535, 'Explicit local test port required');
const options = { host: '127.0.0.1', port, user: 'postgres', max: 1, onnotice: () => {},
  types: { bigint: { to: 20, from: [20], serialize: String, parse: Number } } };
const control = postgres({ ...options, database: 'postgres' });
const database = 'vehicle_race_' + process.pid + '_' + Date.now();
let created = false, a, b, observer;
const uid = id => `00000000-0000-0000-0000-${String(id).padStart(12, '0')}`;
async function actor(client, id, admin = false) {
  await client.unsafe('reset role');
  await client.unsafe("select set_config('request.jwt.claim.sub',$1,false)", [uid(id)]);
  if (!admin) await client.unsafe('set role authenticated');
}
async function waiting(pid, expected) {
  const until = Date.now() + 5000;
  while (Date.now() < until) {
    const rows = await observer.unsafe('select wait_event_type,wait_event from pg_stat_activity where pid=$1', [pid]);
    if (rows[0]?.wait_event_type === 'Lock' && rows[0].wait_event.toLowerCase().includes(expected)) return;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw Error('Expected actual lock wait: ' + expected);
}
const outcome = promise => promise.then(value => ({ value }), error => ({ error }));
const snap = async client => (await client.unsafe('select admin_get_vehicle_master() data'))[0].data;
async function adminSave(client, vehicle, mapping, snapshot, deactivate = []) {
  return client.unsafe('select admin_save_vehicle_master($1,$2,$3,$4)', [
    { ...vehicle, expected_updated_at: vehicle.updated_at }, mapping, snapshot.assignments, deactivate
  ]);
}
try {
  await control.unsafe("do $$begin if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if; if not exists(select 1 from pg_roles where rolname='anon') then create role anon; end if; end$$;");
  await control.unsafe('create database ' + database); created = true;
  a = postgres({ ...options, database }); b = postgres({ ...options, database }); observer = postgres({ ...options, database });
  await observer.unsafe(`
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema auth to authenticated,anon;
    create table employees(id bigint primary key,auth_user_id uuid,active boolean,admin_scope text,name text,department text);
    insert into employees values(1,'${uid(1)}',true,'all','Admin','Office'),(2,'${uid(2)}',true,'none','B','Field'),(3,'${uid(3)}',true,'none','C','Field');
    create function current_employee_id() returns bigint language sql stable security definer set search_path='' as $$select id from public.employees where active and auth_user_id=auth.uid() limit 1$$;
    create function is_application_admin() returns boolean language sql stable security definer set search_path='' as $$select exists(select 1 from public.employees where id=public.current_employee_id() and admin_scope='all')$$;
    create table sites(id bigint primary key,display_name text);
  `).simple();
  for (const file of ['create_driving_report_tables.sql', 'add_employee_default_vehicle.sql', 'add_vehicle_master_management.sql']) {
    await observer.unsafe(await readFile(new URL('../supabase/' + file, import.meta.url), 'utf8')).simple();
  }
  await observer.unsafe("insert into vehicles(vehicle_number,vehicle_name) values('Car1','One'),('Car2','Two'),('Car3','Three')");
  const bPid = (await b.unsafe('select pg_backend_pid() pid'))[0].pid;
  await actor(a, 2); await actor(b, 3);
  await a.unsafe('begin'); await a.unsafe('select set_my_default_vehicle(3)');
  await b.unsafe('begin');
  let result = outcome(b.unsafe('select set_my_default_vehicle(3)'));
  await waiting(bPid, 'advisory'); await a.unsafe('commit');
  assert.match((await result).error.message, /vehicle_already_assigned/); await b.unsafe('rollback');
  assert.equal((await observer.unsafe('select count(*)::int n from employees where default_vehicle_id=3'))[0].n, 1);
  console.log('PASS simultaneous self RPCs actually wait; one owner only');

  // Direct writers do not take the RPC advisory lock: UNIQUE still serializes them.
  await observer.unsafe('update employees set default_vehicle_id=null');
  await actor(a, 1, true); await actor(b, 1, true);
  await a.unsafe('begin'); await a.unsafe('update employees set default_vehicle_id=3 where id=2');
  await b.unsafe('begin'); result = outcome(b.unsafe('update employees set default_vehicle_id=3 where id=3'));
  await waiting(bPid, 'transactionid'); await a.unsafe('commit');
  assert.equal((await result).error.code, '23505'); await b.unsafe('rollback');
  console.log('PASS simultaneous non-RPC writers wait on UNIQUE and reject duplicate');

  await observer.unsafe('update employees set default_vehicle_id=null;update employees set default_vehicle_id=id-1 where id in(2,3)').simple();
  await actor(a, 1); await actor(b, 2);
  let state = await snap(a);
  await a.unsafe('begin'); await adminSave(a, state.vehicles.find(v => v.id === 1), [{ employee_id: 2, vehicle_id: 2 }, { employee_id: 3, vehicle_id: 1 }], state);
  await b.unsafe('begin'); result = outcome(b.unsafe('select set_my_default_vehicle(1)'));
  await waiting(bPid, 'advisory'); await a.unsafe('commit');
  assert.match((await result).error.message, /vehicle_already_assigned/); await b.unsafe('rollback');
  assert.deepEqual((await observer.unsafe('select default_vehicle_id from employees where id in(2,3) order by id')).map(r => r.default_vehicle_id), [2, 1]);
  console.log('PASS admin atomic swap vs simultaneous self-setting remains consistent');

  await actor(b, 1); state = await snap(a);
  await a.unsafe('begin'); await adminSave(a, state.vehicles.find(v => v.id === 1), [{ employee_id: 2, vehicle_id: 1 }, { employee_id: 3, vehicle_id: 2 }], state);
  await b.unsafe('begin'); result = outcome(adminSave(b, state.vehicles.find(v => v.id === 3), [], state));
  await waiting(bPid, 'advisory'); await a.unsafe('commit');
  assert.match((await result).error.message, /vehicle_assignments_changed/); await b.unsafe('rollback');
  console.log('PASS simultaneous admin stale snapshot rejected after lock wait');

  state = await snap(a); await actor(b, 2);
  await a.unsafe('begin'); await adminSave(a, { ...state.vehicles.find(v => v.id === 3), active: false }, [], state);
  await b.unsafe('begin'); result = outcome(b.unsafe('select set_my_default_vehicle(3)'));
  await waiting(bPid, 'advisory'); await a.unsafe('commit');
  assert.match((await result).error.message, /active_vehicle_required/); await b.unsafe('rollback');
  console.log('PASS simultaneous deactivation vs self-setting cannot assign disabled car');
  console.log('PASS 5 real PostgreSQL cross-connection concurrency cases');
} finally {
  for (const client of [a, b, observer]) if (client) await client.end({ timeout: 2 });
  if (created) await control.unsafe('drop database ' + database);
  await control.end();
}
