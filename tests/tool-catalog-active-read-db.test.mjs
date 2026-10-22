// PGlite only. No production connection.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
const {PGlite}=await import(process.env.PGLITE_MODULE?pathToFileURL(process.env.PGLITE_MODULE).href:'@electric-sql/pglite');
const db=await PGlite.create(),q=async(s,a=[])=>(await db.query(s,a)).rows;
const uid=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const read=f=>readFile(new URL('../supabase/'+f,import.meta.url),'utf8');
const actor=async(n,role='authenticated')=>{await db.exec('reset role');await q("select set_config('request.jwt.claim.sub',$1,false)",[n?uid(n):'']);await db.exec('set role '+role);};
let count=0;async function test(name,fn){await fn();count++;console.log('PASS '+name);}
try{
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema auth to authenticated;
 create table public.employees(id bigint primary key,auth_user_id uuid,active boolean,admin_scope text);
 insert into public.employees values(1,'${uid(1)}',true,'none'),(2,'${uid(2)}',true,'tool_admin'),(3,'${uid(3)}',true,'all'),
 (4,'${uid(4)}',false,'none'),(5,'${uid(5)}',false,'all');
 grant select on public.employees to authenticated;
 create table public.tool_catalog(id bigint generated always as identity primary key,tool_group text,tool_name text,code_prefix text,
 inspection_required boolean,inspection_category text,active boolean,sort_order integer,created_at timestamptz default now(),updated_at timestamptz default now());
 insert into public.tool_catalog(tool_group,tool_name,code_prefix,inspection_required,active,sort_order)
 values('工具','有効工具','T',true,true,1),('工具','無効工具','X',false,false,2);
 alter table public.tool_catalog enable row level security;
 grant select,insert,update on public.tool_catalog to authenticated;
 grant usage,select on sequence public.tool_catalog_id_seq to authenticated;
 create policy tool_catalog_read on public.tool_catalog for select to authenticated using(true);
 create table public.tools(id bigint primary key,note text);insert into public.tools values(1,'unchanged');`);
 const extract=(s,name)=>{const start=s.indexOf('create or replace function public.'+name+'(');assert(start>=0);return s.slice(start,s.indexOf('$$;',start)+3);};
 await db.exec(extract(await read('personal_tool_registration.sql'),'is_tool_registration_admin'));
 const base=await read('add_tool_catalog.sql');
 const policy=name=>{const start=base.indexOf('create policy '+name+'\n');assert(start>=0);return base.slice(start,base.indexOf(';',start)+1);};
 for(const name of ['tool_catalog_insert','tool_catalog_update'])await db.exec(policy(name));
 await db.exec(extract(await read('tool_catalog_registration.sql'),'personal_tool_catalog'));
 await db.exec('revoke all on function public.personal_tool_catalog() from public,anon;grant execute on function public.personal_tool_catalog() to authenticated');
 const migration=await read('restrict_tool_catalog_reads.sql'),preflight=await read('tool_catalog_read_security_preflight.sql');
 const before=JSON.stringify(await q('select * from public.tool_catalog order by id'));
 const writesBefore=await q("select polname,pg_get_expr(polqual,polrelid) u,pg_get_expr(polwithcheck,polrelid) c from pg_policy where polrelid='public.tool_catalog'::regclass and polcmd in ('a','w') order by polname");
 await test('preflight is READ ONLY and upgrade preserves rows and write policies',async()=>{
  await db.exec('begin read only');const snapshot=(await q(preflight))[0].tool_catalog_read_security_preflight;await db.exec('rollback');
  assert(snapshot.policies.some(p=>p.policyname==='tool_catalog_read'));
  await db.exec(migration);await db.exec(migration);
  assert.equal(JSON.stringify(await q('select * from public.tool_catalog order by id')),before);
  assert.deepEqual(await q("select polname,pg_get_expr(polqual,polrelid) u,pg_get_expr(polwithcheck,polrelid) c from pg_policy where polrelid='public.tool_catalog'::regclass and polcmd in ('a','w') order by polname"),writesBefore);
 });
 await test('unlinked, inactive and anonymous denied; all active employee categories retain all rows/columns',async()=>{
  for(const id of [null,99,4,5]){await actor(id);assert.equal((await q('select * from public.tool_catalog')).length,0);}
  await actor(null,'anon');await assert.rejects(q('select * from public.tool_catalog'),/permission denied/);
  for(const id of [1,2,3]){await actor(id);const rows=await q('select * from public.tool_catalog order by id');assert.equal(rows.length,2);assert.equal(Object.keys(rows[0]).length,10);}
 });
 await test('additional permissive SELECT and ALL policies cannot bypass restrictive guard',async()=>{
  await actor(null,'postgres');await db.exec('create policy extra_select on public.tool_catalog for select to public using(true);create policy extra_all on public.tool_catalog for all to authenticated using(true) with check(true)');
  for(const id of [99,4]){await actor(id);assert.equal((await q('select * from public.tool_catalog')).length,0);}
  await actor(null,'postgres');await db.exec('drop policy extra_select on public.tool_catalog;drop policy extra_all on public.tool_catalog');
 });
 await test('ordinary employee cannot write; tool and full admins retain registration, update and inactive visibility',async()=>{
  await actor(1);await assert.rejects(q("insert into public.tool_catalog(tool_name,active) values('bad',true)"),/row-level security/);
  assert.equal((await q("update public.tool_catalog set tool_name='bad' where id=1 returning id")).length,0);
  for(const id of [2,3]){await actor(id);await q("insert into public.tool_catalog(tool_name,active) values('new',true)");assert.equal((await q('update public.tool_catalog set sort_order=10 where id=2 returning id')).length,1);}
  await actor(1);assert.equal((await q('select * from public.personal_tool_catalog()')).length,3);
  await actor(99);assert.equal((await q('select * from public.personal_tool_catalog()')).length,0);
  await actor(null,'postgres');assert.equal((await q('select note from public.tools'))[0].note,'unchanged');
 });
 await test('unexpected anonymous grant aborts upgrade; fresh-install policies also enforce active guard',async()=>{
  await db.exec('grant select on public.tool_catalog to anon');
  await assert.rejects(db.exec(migration),/tool_catalog_anon_read_requires_review/);await db.exec('rollback');
  await db.exec('revoke select on public.tool_catalog from anon;drop policy tool_catalog_read on public.tool_catalog;drop policy tool_catalog_active_employee_read_guard on public.tool_catalog');
  await db.exec(policy('tool_catalog_read'));await db.exec(policy('tool_catalog_active_employee_read_guard'));
  await actor(99);assert.equal((await q('select * from public.tool_catalog')).length,0);
  await actor(3);assert((await q('select * from public.tool_catalog where not active')).length===1);
 });
 console.log(`Tool catalog active read: ${count} groups passed.`);
}finally{await db.close();}
