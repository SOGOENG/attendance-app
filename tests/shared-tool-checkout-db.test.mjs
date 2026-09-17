// PGLITE_MODULE=/path/to/pglite/dist/index.js node tests/shared-tool-checkout-db.test.mjs
// Isolated PostgreSQL, never production.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
const { PGlite } = await import(process.env.PGLITE_MODULE ? pathToFileURL(process.env.PGLITE_MODULE).href : '@electric-sql/pglite');
const db = new PGlite();
const q = async (sql, args=[]) => (await db.query(sql,args)).rows;
const uid = n => `00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
const login = async n => { await q("select set_config('test.uid',$1,false)",[n ? uid(n) : '']); await db.exec('set role authenticated'); };
const checkout = (id=295,site=9,employee=12) => q('select * from checkout_shared_tool($1,$2,$3,$4)',[id,site,employee,' note ']);
try {
  await db.exec(`
    create role anon; create role authenticated;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('test.uid',true),'')::uuid $$;
    create table employees(id bigint primary key,auth_user_id uuid,active boolean,admin_scope text);
    create table sites(id bigint primary key,visible boolean);
    create table tools(id bigint primary key, ownership_type text default 'shared', active boolean default true,
      checkout_managed boolean default true,status text default 'available',current_site_id bigint references sites,
      assigned_employee_id bigint references employees,updated_at timestamptz default '2026-09-14');
    create table tool_history(id bigint generated always as identity primary key,tool_id bigint references tools,
      action_type text,from_site_id bigint,to_site_id bigint,from_employee_id bigint,to_employee_id bigint,
      operated_by_employee_id bigint,note text);
    insert into sites values(9,true),(10,false);
    insert into tools(id) values(295),(296),(297);
    alter table tools enable row level security;
    create policy tools_read on tools for select to authenticated using(true);
    -- No employee UPDATE policy: direct update silently affects zero rows.
    grant select,update on tools to authenticated;
    grant select on tool_history to authenticated;
  `);
  for (const [id,scope,active] of [[12,'none',true],[1,'all',true],[2,'tool_admin',true],[13,'none',true],[14,'none',false]]) {
    await q('insert into employees values($1,$2,$3,$4)',[id,uid(id),active,scope]);
  }
  const policies = await q("select * from pg_policies where tablename='tools'");
  await db.exec(await readFile(new URL('../supabase/add_checkout_shared_tool.sql',import.meta.url),'utf8'));
  assert.deepEqual(await q("select * from pg_policies where tablename='tools'"),policies);
  await login(12);
  assert.deepEqual(await q("update tools set current_site_id=9 where id=295 returning id"),[]);
  const [saved] = await checkout(295,9,13); // Forged assignee cannot impersonate another employee.
  assert.equal(saved.current_site_id,9); assert.equal(saved.assigned_employee_id,12);
  assert.equal(saved.status,'in_use'); assert.ok(new Date(saved.updated_at)>new Date('2026-09-14'));
  const [history] = await q('select * from tool_history');
  assert.equal(history.action_type,'checkout'); assert.equal(history.to_site_id,9);
  assert.equal(history.to_employee_id,12); assert.equal(history.operated_by_employee_id,12);
  assert.equal(history.note,'note');
  await assert.rejects(checkout(),/現在持出できません/);
  assert.equal((await q('select * from tool_history')).length,1);
  for (const n of [1,2]) {
    await login(n);
    const [saved] = await checkout(n===1?296:297,9,13);
    assert.equal(saved.assigned_employee_id,13);
    assert.equal((await q('select operated_by_employee_id from tool_history order by id desc limit 1'))[0].operated_by_employee_id,n);
  }
  console.log('PASS: RLS zero-row reproduction; employee checkout; authenticated actor; both administrator scopes; duplicate rejection');

  await db.exec('reset role; insert into tools(id) values(300)');
  for (const [table,behavior] of [['tools','return null'],['tools',"raise exception 'forced update failure'"],['tool_history','return null'],['tool_history',"raise exception 'forced history failure'"]]) {
    await db.exec(`create or replace function fail_write() returns trigger language plpgsql as $$ begin ${behavior}; end $$;
      create trigger fail_write before ${table==='tools'?'update':'insert'} on ${table} for each row execute function fail_write();`);
    const before = await q('select * from tools where id=300');
    const histories = await q('select * from tool_history order by id');
    await login(12);
    await assert.rejects(checkout(300),/失敗|forced/);
    assert.deepEqual(await q('select * from tools where id=300'),before);
    assert.deepEqual(await q('select * from tool_history order by id'),histories);
    await db.exec(`reset role; drop trigger fail_write on ${table}`);
  }
  console.log('PASS: update/history exceptions and zero-row writes roll back both tables');
  await login(12);
  for (const site of [null,10,999]) await assert.rejects(checkout(300,site),/現場/);
  await assert.rejects(checkout(999),/見つかりません/);
  for (const n of [null,14,999]) { await login(n); await assert.rejects(checkout(300),/有効な社員/); }
  await login(1); await assert.rejects(checkout(300,9,14),/有効な持出者/);
  await db.exec('reset role');
  for (const change of ["ownership_type='personal'","active=false","checkout_managed=false","status='repair'","status='stopped'","status='disposed'"]) {
    await db.exec(`update tools set ownership_type='shared',active=true,checkout_managed=true,status='available' where id=300; update tools set ${change} where id=300`);
    await login(12); await assert.rejects(checkout(300),/持出/); await db.exec('reset role');
  }
  await db.exec('set role anon'); await assert.rejects(checkout(300),/permission denied/);
  await db.exec('reset role');
  // Existing return RPC still accepts the checked-out row and records the previous location.
  await db.exec(await readFile(new URL('../supabase/add_return_shared_tool.sql',import.meta.url),'utf8'));
  await login(12); await q('select return_shared_tool(295)');
  const [returned] = await q('select * from tools where id=295');
  assert.equal(returned.current_site_id,null); assert.equal(returned.status,'available');
  assert.equal((await q("select from_site_id from tool_history where action_type='return'"))[0].from_site_id,9);
  console.log('PASS: input/state/authentication guards, anonymous rejection, existing return integration');
} finally { await db.close(); }
