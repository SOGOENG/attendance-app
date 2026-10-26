import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
const {PGlite}=await import(process.env.PGLITE_MODULE?pathToFileURL(process.env.PGLITE_MODULE).href:'@electric-sql/pglite');
const db=new PGlite();
await db.exec(`create role anon;create role authenticated;
create table employees(id bigint primary key);create table applications(id bigint primary key);
create table push_subscriptions(id bigint primary key);
insert into employees values(1);insert into applications values(7);insert into push_subscriptions values(1);`);
await db.exec(await readFile(new URL('../supabase/notification_deliveries.sql',import.meta.url),'utf8'));
await db.exec(`insert into notification_deliveries(notification_type,employee_id,push_subscription_id,notification_date,application_id,event_type,idempotency_key)
values('application_approved',1,1,current_date,7,'approved','application_approved:7:1:1');
alter table notification_deliveries drop constraint notification_deliveries_notification_type_check;
alter table notification_deliveries add constraint notification_deliveries_notification_type_check check(notification_type='application_approved');`);
const migration=await readFile(new URL('../supabase/add_application_final_confirmation_notifications.sql',import.meta.url),'utf8');
await db.exec(migration);await db.exec(migration);
const insert=`insert into notification_deliveries(notification_type,employee_id,push_subscription_id,notification_date,application_id,event_type,idempotency_key)
values('application_final_confirmation_pending',1,1,current_date,7,'final_confirmation_pending','application_final_confirmation_pending:7:1:1')`;
await db.exec(insert);await assert.rejects(db.exec(insert),/unique constraint/);
assert.equal((await db.query('select count(*)::int n from notification_deliveries')).rows[0].n,2);
await db.exec('set role authenticated');await assert.rejects(db.query('select * from notification_deliveries'),/permission denied/);await assert.rejects(db.exec(insert),/permission denied/);
await db.exec('reset role');await db.close();
console.log('PASS: notification migration repeatable, existing delivery preserved, new enum/event accepted, real unique key blocks duplicates, clients cannot read/write');
