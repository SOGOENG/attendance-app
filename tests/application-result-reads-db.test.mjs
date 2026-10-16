// PGLITE_MODULE=/path/to/pglite/dist/index.js node tests/application-result-reads-db.test.mjs
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
const { PGlite } = await import(process.env.PGLITE_MODULE ? pathToFileURL(process.env.PGLITE_MODULE).href : '@electric-sql/pglite');
const db = new PGlite();
const q = async (sql, args=[]) => (await db.query(sql,args)).rows;
await db.exec(`create role anon; create role authenticated;
  create table employees(id bigint primary key, admin_scope text);
  insert into employees values(1,''),(2,'all');
  create function current_employee_id() returns bigint language sql stable as
    $$ select nullif(current_setting('test.actor',true),'')::bigint $$;
  create table applications(id bigint primary key, employee_id bigint, application_type text, status text);
  create table application_status_history(id bigint generated always as identity primary key,
    application_id bigint references applications(id), from_status text, to_status text);
  insert into applications values(1,1,'paid_leave','submitted'),(2,1,'comp_leave','submitted'),(3,2,'paid_leave','submitted');
`);
const migration = await readFile(new URL('../supabase/add_application_result_reads.sql',import.meta.url),'utf8');
await db.exec(migration); await db.exec(migration);
const as = actor => db.exec(`reset role; select set_config('test.actor','${actor}',false); set role authenticated;`);
const unread = () => q('select * from get_unread_application_results()');
const mark = ids => q('select mark_application_results_read($1)',[ids]);
const transition = async (id,status) => {
  await db.exec('reset role');
  const [{id:history}] = await q(`insert into application_status_history(application_id,from_status,to_status)
    select id,status,$2 from applications where id=$1 returning id`,[id,status]);
  await q('update applications set status=$2 where id=$1',[id,status]);
  await as(1); return history;
};
for(const status of ['approved','revision_required','rejected']) {
  await transition(1,'submitted');
  const h = await transition(1,status);
  assert.equal((await unread()).length,1);
  assert.equal((await unread()).length,1); // Reading count never acknowledges.
  await mark([h]); await mark([h]); assert.equal((await unread()).length,0);
}
const revision = await transition(1,'revision_required');
await mark([revision]); await transition(1,'submitted'); assert.equal((await unread()).length,0);
const approval = await transition(1,'approved'); assert.equal((await unread()).length,1);
await mark([revision]); assert.equal((await unread()).length,1); // Delayed old snapshot.
const rejection = await transition(2,'rejected'); assert.equal((await unread()).length,2);
const foreign = await transition(3,'approved');
assert.equal((await unread()).length,2);
await mark([foreign]); assert.equal((await unread()).length,2);
await mark([approval,rejection]); assert.equal((await unread()).length,0);
console.log('PASS: approved/revision/rejected, 2 results, read-only query, acknowledgement, resubmission, stale snapshot, foreign ID');
await as(2); assert.equal((await unread()).length,1);
assert.equal((await q('select * from application_result_reads')).length,0); // Admin cannot see employee 1 reads.
await mark([foreign]); assert.equal((await q('select * from application_result_reads')).length,1);
await as(1);
assert.ok((await q('select * from application_result_reads')).every(r=>r.employee_id===1));
await assert.rejects(q('insert into application_result_reads values(2,$1,now())',[foreign]),/permission denied/);
await assert.rejects(q('delete from application_result_reads'),/permission denied/);
await assert.rejects(q('update application_result_reads set employee_id=2'),/permission denied/);
await db.exec('reset role; set role anon');
await assert.rejects(unread(),/permission denied/); await assert.rejects(mark([]),/permission denied/);
await as(''); assert.equal((await unread()).length,0);
console.log('PASS: RLS self-only including administrators, no direct writes, anonymous denied, unaffiliated actor empty');
await transition(1,'approved'); // Same-state audit is not a new result.
assert.equal((await unread()).length,0);
await transition(1,'cancelled'); assert.equal((await unread()).length,0);
await db.close();
console.log('PASS: audit-only updates/cancellation excluded, repeatable migration, no Push table required');
