// Disposable in-memory PostgreSQL only. Never accepts a production URL.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
const {PGlite}=await import(pathToFileURL(process.env.PGLITE_MODULE).href);
const sql=async n=>readFile(new URL('../supabase/'+n,import.meta.url),'utf8');
const db=await PGlite.create();
const q=async(s,a=[])=>(await db.query(s,a)).rows;
const apply=async f=>db.exec(await sql(f));
const rollback=()=>db.exec('rollback');
const attest=async()=>{
 await q("select set_config('portal.reviewed_login_revision',$1,false)",['a'.repeat(40)]);
 await q("select set_config('portal.id_login_verified','yes',false)");
};
const snapshot=async()=>JSON.stringify(await q(`select
 (select jsonb_agg(to_jsonb(e) order by id) from employees e) data,
 (select relrowsecurity from pg_class where oid='employees'::regclass) rls,
 (select jsonb_agg(jsonb_build_array(role,p,has_table_privilege(role,'employees',p)) order by role,p)
  from unnest(array['anon','authenticated','service_role']) role cross join unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']) p) privileges`));
let groups=0;
try{
 await db.exec(`create role anon;create role authenticated;create role service_role;create role other_reader;
 create table employees(id bigint primary key,name text,auth_user_id uuid,active boolean,admin_scope text);
 insert into employees values(1,'Admin','00000000-0000-4000-8000-000000000001',true,'all');
 grant all on employees to public,anon,authenticated,service_role;
 grant select(name),references(id),update(name) on employees to anon,authenticated;`);
 const before=await snapshot();
 await assert.rejects(apply('restrict_employee_anonymous_reads.sql'),/reviewed_id_login_rollout_required/);await rollback();
 assert.equal(await snapshot(),before);
 console.log('PASS missing deployment attestation rolls back unchanged');groups++;
 await attest();
 await db.exec('grant select on employees to other_reader;grant other_reader to anon');
 const inherited=await snapshot();
 await assert.rejects(apply('restrict_employee_anonymous_reads.sql'),/inherited_anonymous_read/);await rollback();
 assert.equal(await snapshot(),inherited);await db.exec('revoke other_reader from anon');
 console.log('PASS inherited anonymous SELECT stops and rolls back');groups++;
 await db.exec('revoke select on employees from authenticated');
 await assert.rejects(apply('restrict_employee_anonymous_reads.sql'),/authenticated_reads_require_explicit/);await rollback();
 assert.equal((await q("select has_table_privilege('anon','employees','SELECT') ok"))[0].ok,true);
 await db.exec('grant select on employees to authenticated');
 console.log('PASS PUBLIC-only authenticated reads cannot silently be broken');groups++;
 await apply('restrict_employee_anonymous_reads.sql');
 await apply('restrict_employee_anonymous_reads.sql');
 assert.equal((await q("select has_any_column_privilege('anon','employees','SELECT') ok"))[0].ok,false);
 assert.equal((await q("select has_table_privilege('authenticated','employees','SELECT') ok"))[0].ok,true);
 console.log('PASS anonymous table/column/PUBLIC reads closed; authenticated reads preserved; repeat safe');groups++;
 await db.exec('grant trigger on employees to other_reader;grant other_reader to authenticated');
 const triggerInherited=await snapshot();
 await assert.rejects(apply('restrict_employee_direct_writes.sql'),/inherited_write/);await rollback();
 assert.equal(await snapshot(),triggerInherited);await db.exec('revoke other_reader from authenticated');
 await apply('restrict_employee_direct_writes.sql');await apply('restrict_employee_direct_writes.sql');
 for(const role of ['anon','authenticated']){
  assert.equal((await q(`select has_table_privilege($1,'employees','INSERT,UPDATE,DELETE,TRUNCATE,TRIGGER,REFERENCES,MAINTAIN') ok`,[role]))[0].ok,false);
  assert.equal((await q(`select has_any_column_privilege($1,'employees','INSERT,UPDATE,REFERENCES') ok`,[role]))[0].ok,false);
 }
 assert.equal((await q("select has_table_privilege('service_role','employees','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,TRIGGER,REFERENCES,MAINTAIN') ok"))[0].ok,true);
 await db.exec('set role authenticated');assert.equal((await q('select * from employees'))[0].admin_scope,'all');
 await assert.rejects(q("update employees set admin_scope='none' where id=1"),/permission denied/);
 await db.exec('reset role');
 assert.equal((await q('select active,admin_scope from employees'))[0].active,true);
 assert.equal((await q('select active,admin_scope from employees'))[0].admin_scope,'all');
 console.log('PASS write/DDL-adjacent rights closed, service_role unchanged, administrator data untouched');groups++;
 console.log(`${groups} cutover groups passed; no production connection.`);
}finally{await db.close();}
