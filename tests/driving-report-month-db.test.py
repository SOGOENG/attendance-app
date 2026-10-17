"""Isolated PG only. Creates a fresh DB; never drops/deletes any existing data.
PG_BIN may name local PostgreSQL binaries. Uses a fixed /private/tmp socket,
never DATABASE_URL/PGHOST. Core fixture plus full application/balance integration.
"""
import os, pathlib, subprocess, time, select
ROOT = pathlib.Path(__file__).resolve().parents[1]
BIN = pathlib.Path(os.environ.get('PG_BIN', '/private/tmp/attendance-pg-install/bin'))
BASE = [str(BIN/'psql'), '-X', '-A', '-t', '-q', '-v', 'ON_ERROR_STOP=1', '-U', 'attendance_test_owner', '-h', '/private/tmp/attendance-pg-socket', '-p', '55439']
DB = 'attendance_month_test_' + str(time.time_ns())
def sql(code, db=DB):
    p = subprocess.run(BASE+['-d', db], input="set statement_timeout='15s';\n"+code, text=True, capture_output=True, timeout=25)
    if p.returncode: raise RuntimeError(p.stderr + '\n' + p.stdout)
    return p.stdout
sql('create database '+DB, 'template1')
setup = (ROOT/'tests/fuel-receipts-setup.sql').read_text().split('insert into public.employees')[0]
# Resolve psql include paths without modifying the existing setup file.
setup = setup.replace('\\ir ../supabase/', '\\ir '+str(ROOT/'supabase')+'/')
sql(setup)
sql("""
alter table employees add column is_leave_manager boolean not null default false;
insert into employees(id,auth_user_id,active,name,admin_scope) values
(1,'00000000-0000-0000-0000-000000000001',true,'A',null),
(2,'00000000-0000-0000-0000-000000000002',true,'B',null),
(3,'00000000-0000-0000-0000-000000000003',true,'Admin','all');
create table holidays(id bigint generated always as identity, date date, day_type text);
create table attendance(id bigint generated always as identity, employee_id bigint, work_date date,
 site_type text,leave_type text,status text,source_type text,source_application_id bigint, site_id bigint, misc_company text, misc_department text, company_work text, misc_name text, start_time text, end_time text, note text);
create table holiday_work_records(id bigint generated always as identity, employee_id bigint, work_date date, status text default 'active', source_type text default 'manual', source_attendance_id bigint, earned_days numeric, used_days numeric default 0, remaining_days numeric,site_id bigint,note text,created_by_employee_id bigint,updated_by_employee_id bigint);
alter table attendance enable row level security;
create policy attendance_self on attendance for select to authenticated using(employee_id=public.current_employee_id());
grant select on attendance to authenticated;
create table applications(id bigint primary key,employee_id bigint not null references employees(id),status text,application_type text,reviewer_comment text);

create schema storage;
create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text);
""")
# Exact leave tables/FKs/CHECKs from the repository, including both cascade levels.
application_sql=(ROOT/'supabase/application_management.sql').read_text()
sql(application_sql[application_sql.index('create table if not exists public.paid_leave_application_details'):application_sql.index('create table if not exists public.paid_leave_balances')])
sql('alter table comp_leave_dates add column admin_direct boolean not null default false;')
for name in ['add_driving_report_destination.sql','add_driving_report_submission.sql','add_pre_drive_alcohol_checks.sql','add_fuel_receipts.sql','add_application_attendance_sync.sql','fix_application_attendance_overwrite.sql','add_delete_draft_application.sql','add_driving_report_month_submission.sql']:
    sql((ROOT/'supabase'/name).read_text())
# Use repository registration/cancellation bodies, not handwritten substitutes.
application_sql=(ROOT/'supabase/application_management.sql').read_text()
sql("create function public.is_leave_manager() returns boolean language sql as $$select public.is_application_admin()$$; create table comp_leave_allocations(application_id bigint,holiday_work_record_id bigint,allocated_days numeric);")
sql("alter table holiday_work_records enable row level security; create policy holiday_read on holiday_work_records for select to authenticated using(employee_id=public.current_employee_id() or public.is_application_admin()); grant select on holiday_work_records to authenticated;")
for function,next_marker in [('register_holiday_work','create or replace function public.update_holiday_work'),('cancel_holiday_work','-- --------------------------------------------------------------------------\n-- 6. INDEX')]:
    fragment=application_sql[application_sql.index('create or replace function public.'+function):application_sql.index(next_marker,application_sql.index('create or replace function public.'+function))]
    sql(fragment)
sql("""
alter table applications enable row level security;
create policy application_self on applications for all to authenticated using(employee_id=public.current_employee_id()) with check(employee_id=public.current_employee_id());
grant select,delete on applications to authenticated;
alter table paid_leave_application_details enable row level security;
alter table comp_leave_application_details enable row level security;
alter table comp_leave_dates enable row level security;
create policy paid_self on paid_leave_application_details for all to authenticated using(exists(select 1 from applications a where a.id=application_id and a.employee_id=public.current_employee_id() and a.status='draft'));
create policy comp_self on comp_leave_application_details for all to authenticated using(exists(select 1 from applications a where a.id=application_id and a.employee_id=public.current_employee_id() and a.status='draft'));
create policy comp_date_self on comp_leave_dates for all to authenticated using(exists(select 1 from applications a where a.id=application_id and a.employee_id=public.current_employee_id() and a.status='draft'));
grant select,delete on paid_leave_application_details,comp_leave_application_details,comp_leave_dates to authenticated;
""")
AUTH = "set role authenticated; set request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';\n"
ASSERT = """
create function pg_temp.ok(label text,v boolean) returns void language plpgsql as $$begin
 if v is distinct from true then raise exception 'FAIL %',label; end if; raise notice 'PASS %',label; end$$;
create function pg_temp.denied(code text, expected text) returns void language plpgsql as $$begin
 begin execute code; exception when others then
 if position(expected in sqlerrm)=0 then raise; end if; return; end;
 raise exception 'unexpected success: %',code; end$$;
"""
# Explicit handshakes; wait for server-reported lock waits, never fixed sleeps.
def held(code,auth=AUTH):
    proc=subprocess.Popen(BASE+['-d',DB],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
    proc.stdin.write(auth+"begin;\n\\o /dev/null\n"+code+"\n\\o\n\\echo READY\n");proc.stdin.flush()
    deadline=time.monotonic()+10
    while time.monotonic()<deadline:
        if not select.select([proc.stdout],[],[],1)[0]: continue
        line=proc.stdout.readline()
        if line.strip()=='READY': return proc
        if not line: raise RuntimeError(proc.stderr.read())
    raise RuntimeError('handshake timeout')
def release(proc):
    proc.stdin.write('commit;\n');proc.stdin.close()
    assert proc.wait(timeout=10)==0,proc.stderr.read()
def worker(code,name,auth=AUTH):
    proc=subprocess.Popen(BASE+['-d',DB],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
    proc.stdin.write(auth+"set application_name='"+name+"'; set statement_timeout='10s'; "+code+'\n');proc.stdin.close()
    return proc
def wait_lock(name):
    deadline=time.monotonic()+8
    while time.monotonic()<deadline:
        if sql("select exists(select 1 from pg_stat_activity where datname=current_database() and application_name='"+name+"' and wait_event_type='Lock')").strip()=='t': return
        time.sleep(.02) # polling only; success requires an observed server lock wait
    raise AssertionError('no observed lock wait: '+name)
sql("""
insert into holidays(date,day_type) select d,'休日' from generate_series(date '2026-09-21',date '2026-10-20',interval '1 day') d;
update holidays set day_type='出勤' where date in ('2026-09-21','2026-09-22','2026-09-23','2026-09-24','2026-09-25');
insert into attendance(employee_id,work_date,site_type,status) values (1,'2026-09-26','会社勤務','submitted');
insert into applications(id,employee_id,status,application_type) values (1,1,'approved','paid_leave'),(2,1,'approved','comp_leave');
insert into paid_leave_application_details(application_id,start_date,end_date,days,day_part) values (1,'2026-09-24','2026-09-24',1,'full');
insert into comp_leave_application_details(application_id) values (2);
insert into comp_leave_dates(application_id,leave_date,days) values(2,'2026-09-25',1);
""")
sql(ASSERT+AUTH+"""
select pg_temp.ok('October boundaries',check_driving_report_month('2026-10-01')->>'period_start'='2026-09-21'
 and check_driving_report_month('2026-10-01')->>'period_end'='2026-10-20');
select pg_temp.ok('year rollover',check_driving_report_month('2027-01-01')->>'period_start'='2026-12-21');
select pg_temp.ok('leap period',(select count(*)=29 from jsonb_array_elements(check_driving_report_month('2024-03-01')->'days')));
select pg_temp.denied($q$select check_driving_report_month('2026-10-02')$q$,'invalid_closing_month');
select pg_temp.ok('real server eligibility', (check_driving_report_month('2026-10-01')->>'eligible')::boolean =
 ((statement_timestamp() at time zone 'Asia/Tokyo')::date>=date '2026-10-21'));
""")
# Freeze ONLY the local check function clock; production migration has no clock override.
def clock(day):
    # psql formatting is avoided by reusing the migration function source.
    source=(ROOT/'supabase/add_driving_report_month_submission.sql').read_text()
    source=source[source.index('create function public.check_driving_report_month'):source.index('create function public.submit_driving_report_month')]
    source=source.replace('create function','create or replace function',1).replace("(statement_timestamp() at time zone 'Asia/Tokyo')::date", "date '"+day+"'")
    sql(source)
clock('2026-10-20')
sql(ASSERT+AUTH+"select pg_temp.denied($q$select submit_driving_report_month('2026-10-01')$q$,'driving_month_not_closed');")
clock('2026-10-21')
sql(ASSERT+AUTH+"""
select pg_temp.ok('full leave exempt',(select bool_and(not (x->>'required')::boolean) from jsonb_array_elements(check_driving_report_month('2026-10-01')->'days') x where x->>'date' in ('2026-09-24','2026-09-25')));
select pg_temp.ok('holiday work required',exists(select 1 from jsonb_array_elements(check_driving_report_month('2026-10-01')->'errors') x where x->>'date'='2026-09-26' and x->>'code'='report_missing'));
insert into driving_reports(employee_id,report_date,driving_status) values
(1,'2026-09-21','no_driving'),(1,'2026-09-22','no_driving'),(1,'2026-09-23','driven'),(1,'2026-09-26','no_driving');
select submit_driving_report(id) from driving_reports where report_date='2026-09-21';
select pg_temp.denied($q$select submit_driving_report_month('2026-10-01')$q$,'driving_month_validation_failed');
select pg_temp.ok('failed month keeps other drafts',(select status='draft' from driving_reports where report_date='2026-09-22'));
select pg_temp.ok('no monthly row on failure',not exists(select 1 from driving_report_month_submissions));
""")
sql(AUTH+"insert into driving_reports(employee_id,report_date,driving_status) values(1,'2026-10-08','no_driving');")
sql(ASSERT+AUTH+"select pg_temp.ok('holiday report included',exists(select 1 from jsonb_array_elements(check_driving_report_month('2026-10-01')->'days') x where x->>'date'='2026-10-08' and (x->>'required')::boolean));")
# Real approval trigger + actual sync SQL: a multi-day paid leave skips holidays.
sql("""
update holidays set day_type='出勤' where date in ('2026-10-02','2026-10-05');
insert into applications(id,employee_id,status,application_type) values(10,1,'draft','paid_leave'),(11,1,'draft','comp_leave');
insert into paid_leave_application_details(application_id,start_date,end_date,days,day_part) values(10,'2026-10-02','2026-10-05',2,'full');
insert into comp_leave_application_details(application_id) values(11);
insert into comp_leave_dates(application_id,leave_date,days) values(11,'2026-10-06',1);
update applications set status='approved' where id in (10,11);
""")
sql(ASSERT+AUTH+"""
select pg_temp.ok('real sync draft leave rows',(select count(*)=3 from attendance where source_application_id in (10,11) and status='draft' and site_type='休み'));
select pg_temp.ok('weekend in approved range not ambiguous',not exists(select 1 from jsonb_array_elements(check_driving_report_month('2026-10-01')->'errors') x where x->>'date' in ('2026-10-03','2026-10-04')));
""")
# Active holiday-work registration without attendance requires a report.
sql(AUTH.replace('000000000001','000000000003')+"select public.register_holiday_work(1,'2026-09-29',1);")
sql(ASSERT+AUTH+"select pg_temp.ok('holiday register missing report',exists(select 1 from jsonb_array_elements(check_driving_report_month('2026-10-01')->'errors') x where x->>'date'='2026-09-29' and x->>'code'='report_missing'));")
sql("insert into attendance(employee_id,work_date,site_type,status) values(1,'2026-09-29','休み','submitted');")
sql(ASSERT+AUTH+"select pg_temp.ok('holiday attendance conflict',exists(select 1 from jsonb_array_elements(check_driving_report_month('2026-10-01')->'errors') x where x->>'code'='holiday_work_attendance_conflict'));")
sql(AUTH.replace('000000000001','000000000003')+"select public.cancel_holiday_work(id) from public.holiday_work_records where work_date='2026-09-29';")
sql("update attendance set site_type='会社勤務' where work_date='2026-09-29';")
sql(AUTH+"insert into driving_reports(employee_id,report_date,driving_status) values(1,'2026-09-29','no_driving');")
# Unknown/half-leave block even if a report is present.
sql("insert into attendance(employee_id,work_date,site_type,status) values(1,'2026-09-27','会社勤務','draft');")
sql(ASSERT+AUTH+"select pg_temp.ok('unconfirmed blocks',exists(select 1 from jsonb_array_elements(check_driving_report_month('2026-10-01')->'errors') x where x->>'code'='work_unconfirmed'));")
sql("update attendance set status='submitted' where work_date='2026-09-27'; insert into applications(id,employee_id,status,application_type) values(3,1,'approved','paid_leave'); insert into paid_leave_application_details(application_id,start_date,end_date,days,day_part) values(3,'2026-09-28','2026-09-28',0.5,'am');")
sql(ASSERT+AUTH+"select pg_temp.ok('half leave blocks',exists(select 1 from jsonb_array_elements(check_driving_report_month('2026-10-01')->'errors') x where x->>'code'='half_or_ambiguous_leave'));")
sql("insert into attendance(employee_id,work_date,site_type,status) values(1,'2026-09-28','会社勤務','submitted');")
sql(ASSERT+AUTH+"select pg_temp.ok('half leave confirmed work requires report',exists(select 1 from jsonb_array_elements(check_driving_report_month('2026-10-01')->'errors') x where x->>'date'='2026-09-28' and x->>'code'='report_missing'));")
sql(AUTH+"insert into driving_reports(employee_id,report_date,driving_status) values(1,'2026-09-28','no_driving');")
sql("update applications set status='cancelled' where id=3; insert into vehicles(vehicle_number,vehicle_name) values('TEST','Test');")
sql(AUTH+"""
update driving_reports set vehicle_id=1,outbound_route_type='office',return_route_type='office',start_odometer=100,end_odometer=200 where report_date='2026-09-23';
insert into driving_report_inspections(driving_report_id,inspection_item_code,result,checked_at)
select r.id,i.inspection_item_code,'ok',now() from driving_reports r cross join driving_report_inspection_items() i where report_date='2026-09-23';
insert into driving_alcohol_checks(driving_report_id,check_type,checked_at,alcohol_value,phone_confirmed,confirmed_by_name_snapshot)
select r.id,c,now(),0,true,'中尾' from driving_reports r cross join unnest(array['commute_before','return_before']) c where report_date='2026-09-23';
insert into driving_refuels(driving_report_id,refueled_at,liters,odometer_km) select id,now(),10,150 from driving_reports where report_date='2026-09-23';
insert into driving_refuels(driving_report_id,refueled_at,liters,odometer_km) select id,now(),20,180 from driving_reports where report_date='2026-09-23';
insert into driving_reports(employee_id,report_date,driving_status) values(1,'2026-09-27','no_driving');
""")
sql("""insert into fuel_receipts(id,refuel_id,report_id,employee_id,object_path,original_name,mime,bytes,sha256,state)
select '10000000-0000-0000-0000-000000000001',f.id,r.id,1,'test/path','test.jpg','image/jpeg',100,repeat('a',64),'pending'
from driving_reports r join driving_refuels f on f.driving_report_id=r.id where report_date='2026-09-23' order by f.id limit 1;""")
sql(ASSERT+AUTH+"select pg_temp.denied($q$select submit_driving_report_month('2026-10-01')$q$,'driving_month_validation_failed');")
sql("update fuel_receipts set state='active';")
SERVICE=AUTH.replace('set role authenticated','set role service_role')
ACTOR='00000000-0000-0000-0000-000000000001'
RID=sql("select min(f.id) from driving_refuels f join driving_reports r on r.id=f.driving_report_id where r.employee_id=1").strip()
def receipt(action,data):
    import json
    return "select public.fuel_receipt_command('"+ACTOR+"','"+action+"','"+json.dumps(data)+"'::jsonb);"
OLD='10000000-0000-0000-0000-000000000001'
NEW='10000000-0000-0000-0000-000000000002'
sql(SERVICE+receipt('remove_begin',{'id':OLD})+receipt('remove_done',{'id':OLD}))
# Receipt RPC first: month submit waits on gate BEFORE locking report rows.
proc=held(receipt('reserve',{'id':NEW,'refuel_id':int(RID),'sha256':'b'*64,'bytes':100,'name':'replacement.jpg','mime':'image/jpeg'}),SERVICE)
peer=worker("select submit_driving_report_month('2026-10-01');",'month_wait_receipt')
wait_lock('month_wait_receipt');release(proc)
assert peer.wait(timeout=10)!=0 and 'driving_month_validation_failed' in peer.stderr.read()
sql(SERVICE+receipt('finalize',{'id':NEW}))
sql(ASSERT+AUTH+"select pg_temp.ok('replacement relation retained',(select count(*)=2 from driving_refuels));")
# Prove rollback even AFTER all daily rows were updated: final monthly insert fails.
sql("create function test_fail_month() returns trigger language plpgsql as $$begin raise exception 'injected_month_insert_failure'; end$$; create trigger test_fail before insert on driving_report_month_submissions for each row execute function test_fail_month();")
sql(ASSERT+AUTH+"""
select pg_temp.denied($q$select submit_driving_report_month('2026-10-01')$q$,'injected_month_insert_failure');
select pg_temp.ok('whole transaction rollback',(select count(*)=7 from driving_reports where employee_id=1 and status='draft'));
select pg_temp.ok('legacy remains submitted',(select status='submitted' from driving_reports where report_date='2026-09-21'));
""")
sql('drop trigger test_fail on driving_report_month_submissions;')
# Save first: submission must observe its commit, then revalidate.
proc=held("update driving_reports set note='concurrent save' where report_date='2026-09-22';")
peer=worker("select submit_driving_report_month('2026-10-01');",'month_wait_save')
wait_lock('month_wait_save'); release(proc)
assert peer.wait(timeout=10)==0,peer.stderr.read()
sql(ASSERT+AUTH+"""
select pg_temp.ok('all submitted',(select bool_and(status='submitted') from driving_reports where employee_id=1));
select pg_temp.ok('two refuels retained',(select count(*)=2 from driving_refuels));
select pg_temp.ok('retry returns same record',submit_driving_report_month('2026-10-01')->>'id'=submit_driving_report_month('2026-10-01')->>'id');
select pg_temp.denied($q$update driving_reports set status='draft' where report_date='2026-09-22'$q$,'driving_month_already_submitted');
select pg_temp.denied($q$insert into driving_reports(employee_id,report_date,driving_status) values(1,'2026-10-01','no_driving')$q$,'driving_month_already_submitted');
select pg_temp.denied($q$update driving_refuels set liters=11$q$,'driving_month_already_submitted');
select pg_temp.denied($q$insert into driving_report_month_submissions(employee_id,closing_month,period_start,period_end,submitted_by,snapshot) values(1,'2026-09-01','2026-08-21','2026-09-20',1,'{}')$q$,'permission denied');
reset role; set role authenticated; set request.jwt.claim.sub='00000000-0000-0000-0000-000000000002';
select pg_temp.ok('other employee cannot read',not exists(select 1 from driving_report_month_submissions));
reset role; set role authenticated; set request.jwt.claim.sub='00000000-0000-0000-0000-000000000003';
select pg_temp.ok('global admin read',(select count(*)=1 from driving_report_month_submissions));
""")
# Existing receipt viewing/review/export metadata and audit remain usable.
admin_service=SERVICE.replace('000000000001','000000000003')
admin_actor=ACTOR.replace('000000000001','000000000003')
view=receipt('view',{'id':NEW}).replace(ACTOR,admin_actor)
review=receipt('review',{'refuel_id':int(RID),'received':True}).replace(ACTOR,admin_actor)
exports=receipt('exports',{}).replace(ACTOR,admin_actor)
sql(admin_service+view+review+exports)
sql(ASSERT+"select pg_temp.ok('receipt audit retained',exists(select 1 from fuel_receipt_audit where event='view' and target='"+NEW+"')); select pg_temp.ok('original receipt review retained',exists(select 1 from fuel_receipt_reviews where refuel_id="+RID+" and received));")
# All detail INSERT/UPDATE/DELETE paths reject edits after monthly submission.
report_id=sql("select id from driving_reports where employee_id=1 and report_date='2026-09-23'").strip()
mutations=[
 "insert into driving_report_inspections values("+report_id+",'extra','ok',null,now())",
 "update driving_report_inspections set result='ok' where driving_report_id="+report_id,
 "delete from driving_report_inspections where driving_report_id="+report_id,
 "insert into driving_alcohol_checks(driving_report_id,check_type) values("+report_id+",'commute_before')",
 "update driving_alcohol_checks set alcohol_value=0 where driving_report_id="+report_id,
 "delete from driving_alcohol_checks where driving_report_id="+report_id,
 "insert into driving_refuels(driving_report_id,refueled_at,liters) values("+report_id+",now(),1)",
 "update driving_refuels set liters=10 where driving_report_id="+report_id,
 "delete from driving_refuels where driving_report_id="+report_id,
]
for mutation in mutations:
    test_auth=AUTH
    if mutation.startswith('delete'):
        table=mutation.split()[2]
        before=sql('select count(*) from '+table).strip()
        sql(AUTH+mutation+';') # existing RLS hides submitted details from DELETE
        assert sql('select count(*) from '+table).strip()==before
        test_auth=AUTH.replace('set role authenticated;', '') # prove trigger also blocks owner writes
    sql(ASSERT+test_auth+"select pg_temp.denied($q$"+mutation+"$q$,'driving_month_already_submitted');")
# Month RPC holds gate; receipt RPC waits then rechecks draft authorization.
proc=held("select submit_driving_report_month('2026-10-01');")
peer=worker(receipt('remove_begin',{'id':NEW}),'receipt_wait_month',SERVICE)
wait_lock('receipt_wait_month');release(proc)
assert peer.wait(timeout=10)!=0 and 'own_draft_required' in peer.stderr.read()
# Calendar edit and source changes cannot race with a locked submission.
proc=held("select submit_driving_report_month('2026-10-01');")
sql(ASSERT+"select pg_temp.denied($q$update attendance set status='draft' where employee_id=1 and work_date='2026-09-27'$q$,'driving_month_busy_retry'); select pg_temp.denied($q$update holidays set day_type='出勤' where date='2026-10-08'$q$,'driving_calendar_busy_retry');")
release(proc)
# Submit first: direct REST writes fail fast; retry then observes submitted.
AUTH2 = AUTH.replace('000000000001', '000000000002')
sql(AUTH2+"insert into driving_reports(employee_id,report_date,driving_status) select 2,d,'no_driving' from generate_series(date '2026-09-21',date '2026-09-25',interval '1 day') d;")
sql(AUTH2+"insert into driving_reports(employee_id,report_date,driving_status) values(2,'2026-10-02','no_driving'),(2,'2026-10-05','no_driving');")
proc=held("select submit_driving_report_month('2026-10-01');",AUTH2)
peer=worker("select submit_driving_report_month('2026-10-01');",'month_duplicate',AUTH2)
wait_lock('month_duplicate')
sql(ASSERT+AUTH2+"select pg_temp.denied($q$insert into driving_reports(employee_id,report_date,driving_status) values(2,'2026-10-07','no_driving')$q$,'driving_month_busy_retry');")
# Other employee and same employee's different closing month must NOT wait.
sql(AUTH.replace('000000000001','000000000003')+"insert into driving_reports(employee_id,report_date,driving_status) values(3,'2026-10-10','no_driving');")
sql(AUTH2+"insert into driving_reports(employee_id,report_date,driving_status) values(2,'2026-08-22','no_driving');")
release(proc)
assert peer.wait(timeout=10)==0,peer.stderr.read()
sql(ASSERT+AUTH2+"select pg_temp.ok('concurrent submit unique',(select count(*)=1 from driving_report_month_submissions)); select pg_temp.denied($q$insert into driving_reports(employee_id,report_date,driving_status) values(2,'2026-10-07','no_driving')$q$,'driving_month_already_submitted');")
# Connection lost before COMMIT: no monthly record, retry completes once.
sql("insert into holidays(date,day_type) select d,'休日' from generate_series(date '2026-07-21',date '2026-08-20',interval '1 day') d;")
proc=held("select submit_driving_report_month('2026-08-01');")
proc.stdin.close() # psql exits without COMMIT; backend rolls back its transaction
assert proc.wait(timeout=10)==0,proc.stderr.read()
sql(ASSERT+AUTH+"select pg_temp.ok('disconnect rollback',not exists(select 1 from driving_report_month_submissions where closing_month='2026-08-01')); select submit_driving_report_month('2026-08-01'); select pg_temp.ok('lost-response retry idempotent',submit_driving_report_month('2026-08-01')->>'id'=submit_driving_report_month('2026-08-01')->>'id');")
# Real FK cascade regression: both application kinds, both deletion entry points.
OWNER=AUTH.replace('set role authenticated;', '')
def make_application(aid,kind,date='2026-05-18',end=None):
    sql("insert into applications(id,employee_id,status,application_type) values("+str(aid)+",1,'draft','"+kind+"');")
    if kind=='paid_leave':
        sql("insert into paid_leave_application_details(application_id,start_date,end_date,days,day_part) values("+str(aid)+",'"+date+"','"+(end or date)+"',1,'full');")
    else:
        sql("insert into comp_leave_application_details(application_id) values("+str(aid)+"); insert into comp_leave_dates(application_id,leave_date,days) values("+str(aid)+",'"+date+"',1),("+str(aid)+",date '"+(end or date)+"'+1,1);")
def graph_gone(aid):
    sql(ASSERT+"select pg_temp.ok('application graph removed',not exists(select 1 from applications where id="+str(aid)+") and not exists(select 1 from paid_leave_application_details where application_id="+str(aid)+") and not exists(select 1 from comp_leave_application_details where application_id="+str(aid)+") and not exists(select 1 from comp_leave_dates where application_id="+str(aid)+")); select pg_temp.ok('context cleaned',not exists(select 1 from driving_month_application_deletions));")
for aid,kind in [(100,'paid_leave'),(101,'comp_leave'),(102,'paid_leave'),(103,'comp_leave')]:
    make_application(aid,kind)
    sql(AUTH+("delete from applications where id="+str(aid)+";" if aid<102 else "select delete_draft_application("+str(aid)+");"))
    graph_gone(aid)
# Direct child deletion, including comp parent -> comp dates cascade, keeps ownership.
make_application(110,'paid_leave');make_application(111,'comp_leave')
sql(AUTH+"delete from paid_leave_application_details where application_id=110; delete from comp_leave_dates where application_id=111 and leave_date='2026-05-18'; delete from comp_leave_application_details where application_id=111;")
sql(ASSERT+"select pg_temp.ok('direct detail deletion',not exists(select 1 from paid_leave_application_details where application_id=110) and not exists(select 1 from comp_leave_dates where application_id=111));")
sql(AUTH+"select delete_draft_application(110); select delete_draft_application(111);")
# SET CONSTRAINTS IMMEDIATE and multiple parents in a single DELETE also work.
make_application(112,'paid_leave');make_application(113,'comp_leave')
sql(AUTH+"begin; set constraints all immediate; delete from applications where id in (112,113); commit;")
graph_gone(112);graph_gone(113)
# A later error rolls back parent, all cascaded children, gates and context.
make_application(120,'paid_leave');make_application(121,'comp_leave')
sql(ASSERT+AUTH+"select pg_temp.denied($q$do $b$ begin delete from applications where id in (120,121); raise exception 'injected_delete_failure'; end $b$$q$,'injected_delete_failure');")
sql(ASSERT+"select pg_temp.ok('cascade rollback',(select count(*)=2 from applications where id in (120,121)) and exists(select 1 from paid_leave_application_details where application_id=120) and (select count(*)=2 from comp_leave_dates where application_id=121)); select pg_temp.ok('rollback context empty',not exists(select 1 from driving_month_application_deletions));")
# Ownership, non-draft RPC protection, and private context cannot be bypassed.
sql(ASSERT+AUTH.replace('000000000001','000000000002')+"select pg_temp.denied($q$select delete_draft_application(120)$q$,'draft_application_owner_required');")
sql(ASSERT+AUTH+"select pg_temp.denied($q$select * from driving_month_application_deletions$q$,'permission denied'); select pg_temp.denied($q$insert into driving_month_application_deletions values(pg_current_xact_id(),120,1,'{2026-06-01}')$q$,'permission denied');")
# Actual approval/cancellation sync and revision status outside submitted periods.
make_application(130,'paid_leave','2026-05-11');make_application(131,'comp_leave','2026-05-12')
sql("update applications set status='approved' where id in (130,131);")
sql(ASSERT+AUTH+"select pg_temp.denied($q$select delete_draft_application(130)$q$,'application_not_draft');")
sql("update applications set status='cancelled' where id in (130,131);")
sql(ASSERT+"select pg_temp.ok('cancellation sync unchanged',not exists(select 1 from attendance where source_application_id in (130,131)));")
make_application(132,'paid_leave','2026-05-16')
sql("update applications set status='submitted' where id=132; update applications set status='revision_required' where id=132; update applications set status='draft' where id=132;")
sql(AUTH+"select delete_draft_application(132);");graph_gone(132)
# Cross-month deletion obtains both months before parent disappears.
make_application(140,'paid_leave','2026-04-20','2026-04-21')
proc=held('select delete_draft_application(140);')
sql(ASSERT+OWNER+"select pg_temp.denied($q$select driving_month_lock(1,'2026-04-01',true)$q$,'driving_month_busy_retry'); select pg_temp.denied($q$select driving_month_lock(1,'2026-05-01',true)$q$,'driving_month_busy_retry');")
release(proc);graph_gone(140)
# Delete first: submission waits for the captured employee/month, then sees deletion.
sql("insert into holidays(date,day_type) select d,'休日' from generate_series(date '2026-06-21',date '2026-07-20',interval '1 day') d;")
make_application(150,'paid_leave','2026-07-01');make_application(151,'comp_leave','2026-07-02')
proc=held('select delete_draft_application(150); select delete_draft_application(151);')
peer=worker("select submit_driving_report_month('2026-07-01');",'month_wait_cascade')
wait_lock('month_wait_cascade');release(proc)
assert peer.wait(timeout=10)==0,peer.stderr.read()
graph_gone(150);graph_gone(151)
# Submit first: deleting either parent or child fails fast, then rejects after commit.
sql("insert into holidays(date,day_type) select d,'休日' from generate_series(date '2026-05-21',date '2026-06-20',interval '1 day') d;")
make_application(160,'paid_leave','2026-06-01');make_application(161,'comp_leave','2026-06-02')
proc=held("select submit_driving_report_month('2026-06-01');")
for operation in ["select delete_draft_application(160)","select delete_draft_application(161)","delete from applications where id=160","delete from paid_leave_application_details where application_id=160","delete from comp_leave_application_details where application_id=161","delete from comp_leave_dates where application_id=161"]:
    sql(ASSERT+AUTH+"select pg_temp.denied($q$"+operation+"$q$,'driving_month_busy_retry');")
release(proc)
for operation in ["select delete_draft_application(160)","select delete_draft_application(161)","delete from applications where id=160","delete from paid_leave_application_details where application_id=160","delete from comp_leave_application_details where application_id=161","delete from comp_leave_dates where application_id=161"]:
    sql(ASSERT+AUTH+"select pg_temp.denied($q$"+operation+"$q$,'driving_month_application_locked');")
for operation in ["update applications set status='approved' where id=160","update paid_leave_application_details set end_date='2026-06-03' where application_id=160","update comp_leave_dates set days=0.5 where application_id=161"]:
    sql(ASSERT+OWNER+"select pg_temp.denied($q$"+operation+"$q$,'driving_month_application_locked');")
sql(ASSERT+"select pg_temp.ok('blocked graphs retained',(select count(*)=2 from applications where id in (160,161)) and exists(select 1 from paid_leave_application_details where application_id=160) and (select count(*)=2 from comp_leave_dates where application_id=161)); select pg_temp.ok('no context leak',not exists(select 1 from driving_month_application_deletions));")
print('PASS cascade: real FK + paid/comp direct parent, RPC, child deletion; normal/immediate-constraint cleanup; multi-parent/multi-month; approval/cancel/revision; rollback/owner/context ACL; both concurrency directions and submitted-month protection.')
for role in ['anon','service_role']:
    sql(ASSERT+"set role "+role+"; select pg_temp.denied($q$select * from driving_month_application_deletions$q$,'permission denied');")
# Removing identity cannot invoke security-definer submission/check RPCs.
sql(ASSERT+"set role authenticated; set request.jwt.claim.sub=''; select pg_temp.denied($q$select check_driving_report_month('2026-10-01')$q$,'active_employee_required');")
print('PASS: actual leave approval/sync and holiday-work register/cancel, receipt reserve/finalize/remove/replacement, source/calendar contention, detail INSERT/UPDATE/DELETE, independent employee/month writes; period/rollover/leap, real eligibility + isolated Oct20/21 clock, work/holiday/leave/unknown, driven/no-driving, legacy submit, multiple refuels/receipt pending, all-or-nothing rollback after updates, concurrent save waiting, simultaneous submission/new insert, retry, post-submit guards, owner/admin RLS. No production access.')
print('Retained isolated fixture DB:',DB)
# Recheck the existing real half-day fixtures with the differential applied.
sql((ROOT/'supabase/fix_driving_month_calendar_holiday_attendance.sql').read_text())
sql(ASSERT+OWNER+"""
begin;
insert into holidays(date,day_type) values('2026-03-10','出勤');
insert into applications(id,employee_id,status,application_type) values(190,1,'approved','paid_leave');
insert into paid_leave_application_details(application_id,start_date,end_date,days,day_part) values(190,'2026-03-10','2026-03-10',0.5,'am');
insert into attendance(employee_id,work_date,site_type,status) values(1,'2026-03-10','会社勤務','submitted');
select pg_temp.ok('patched half leave confirmed work still required',exists(select 1 from jsonb_array_elements(check_driving_report_month('2026-03-01')->'days') d where d->>'date'='2026-03-10' and (d->>'required')::boolean and d->>'issue'='report_missing'));
update attendance set status='draft' where employee_id=1 and work_date='2026-03-10';
select pg_temp.ok('patched half leave unconfirmed blocks',exists(select 1 from jsonb_array_elements(check_driving_report_month('2026-03-01')->'errors') d where d->>'date'='2026-03-10' and d->>'code'='half_or_ambiguous_leave'));
rollback;
""")

# A second DB uses the complete application/balance migrations, not the small
# source-guard fixture above. Keep both DBs for inspection; never contact Supabase.
DB += '_integration'
sql.__defaults__ = (DB,)
sql('create database '+DB, 'template1')
sql(setup)
sql("""
alter table employees add column is_leave_manager boolean not null default false;
insert into employees(id,auth_user_id,active,name,admin_scope) values
(1,'00000000-0000-0000-0000-000000000001',true,'A',null),
(2,'00000000-0000-0000-0000-000000000002',true,'B',null),
(3,'00000000-0000-0000-0000-000000000003',true,'Admin','all');
create table holidays(id bigint generated always as identity primary key,date date,day_type text);
create table attendance(id bigint generated always as identity primary key,employee_id bigint,work_date date,
site_type text,leave_type text,status text,source_type text,source_application_id bigint,site_id bigint,
misc_company text,misc_department text,company_work text,misc_name text,start_time text,end_time text,note text);
create schema storage;
create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text);
""")
for name in ['application_management.sql',
             'add_admin_paid_leave_usage.sql','add_admin_comp_leave_usage.sql',
             'fix_comp_leave_reservations.sql','add_comp_leave_expiration.sql',
             'fix_comp_leave_expiration_visibility_and_automation.sql',
             'add_admin_comp_leave_usage_edit.sql','add_application_print_status.sql',
             'add_application_attendance_sync.sql','fix_application_attendance_overwrite.sql',
             'add_delete_draft_application.sql','add_driving_report_destination.sql',
             'add_driving_report_submission.sql','add_pre_drive_alcohol_checks.sql','add_fuel_receipts.sql']:
    sql((ROOT/'supabase'/name).read_text())
# Actual production CHECK captured by the read-only catalog review. The older
# migration conditionally preserves an existing CHECK, so replay alone is not
# proof of production equivalence. This change is ONLY in this fresh local DB.
sql("""
alter table comp_leave_dates drop constraint comp_leave_dates_days_check;
alter table comp_leave_dates add constraint comp_leave_dates_days_check
 check ((days=any(array[0.5,1.0])) or (admin_direct and days>0 and days<>'NaN'::numeric));
update employees set is_leave_manager=true where id=3;
""")
sql((ROOT/'supabase/add_driving_report_month_submission.sql').read_text())
ADMIN=AUTH.replace('000000000001','000000000003')
sql('grant execute on function sync_application_attendance_date(bigint,bigint,date,text),sync_approved_application_attendance(bigint) to anon,authenticated,service_role;')
sql(ASSERT+"select pg_temp.ok('old helper browser grant reproduced',has_function_privilege('authenticated','sync_application_attendance_date(bigint,bigint,date,text)','execute'));")
sql((ROOT/'supabase/restrict_application_attendance_sync.sql').read_text())
for role in ['anon','authenticated','service_role']:
    sql(ASSERT+"select pg_temp.ok('internal helper revoked',not has_function_privilege('"+role+"','sync_application_attendance_date(bigint,bigint,date,text)','execute') and not has_function_privilege('"+role+"','sync_approved_application_attendance(bigint)','execute'));")
sql(ASSERT+AUTH+"select pg_temp.denied($q$select sync_application_attendance_date(1,1,'2026-09-21','有給')$q$,'permission denied');")
clock('2026-10-21')
sql("insert into holidays(date,day_type) select d,'休日' from generate_series(date '2026-09-21',date '2026-10-20',interval '1 day') d; update holidays set day_type='出勤' where date in ('2026-09-21','2026-09-22','2026-09-23');")
sql(ADMIN+"select set_paid_leave_opening_balance(1,2026,20,0,0,0,'2026-04-01'); select register_holiday_work(1,'2026-08-01',10);")

def paid(day,days=1,part='full'):
    return new_leave('paid_leave',day,days,part)

def new_leave(kind,day,days=1,part='full'):
    aid=int(sql(AUTH+"insert into applications(application_type,employee_id) values('"+kind+"',1) returning id;").strip())
    if kind=='paid_leave':
        sql(AUTH+"insert into paid_leave_application_details(application_id,start_date,end_date,days,day_part) values("+str(aid)+",'"+day+"','"+day+"',"+str(days)+",'"+part+"');")
    else:
        sql(AUTH+"insert into comp_leave_application_details(application_id) values("+str(aid)+"); insert into comp_leave_dates(application_id,leave_date,days) values("+str(aid)+",'"+day+"',"+str(days)+"); insert into comp_leave_allocations(application_id,holiday_work_record_id,allocated_days) select "+str(aid)+",id,"+str(days)+" from holiday_work_records where employee_id=1 and work_date='2026-08-01';")
    return aid

def approve(aid):
    sql(AUTH+"select submit_application("+str(aid)+");")
    sql(ADMIN+"select review_application("+str(aid)+",'approved');")

paid_id=paid('2026-09-21'); approve(paid_id)
comp_id=new_leave('comp_leave','2026-09-22'); approve(comp_id)
sql(ASSERT+"select pg_temp.ok('real approved sync produces draft leave', (select count(*)=2 from attendance where source_application_id in ("+str(paid_id)+","+str(comp_id)+") and status='draft')); select pg_temp.ok('paid balance debited',(select remaining_days=19 from paid_leave_balances where employee_id=1)); select pg_temp.ok('comp allocation debited',(select used_days=1 from holiday_work_records where work_date='2026-08-01'));")
# Actual review outcomes, cancellation and half-day failure roll back balances.
for kind,day in [('paid_leave','2026-09-02'),('comp_leave','2026-09-03')]:
    aid=new_leave(kind,day); approve(aid)
    sql(ADMIN+"select cancel_application("+str(aid)+",'local test');")
    sql(ASSERT+"select pg_temp.ok('cancel attendance removed',not exists(select 1 from attendance where source_application_id="+str(aid)+"));")
for decision in ['rejected','revision_required']:
    for kind in ['paid_leave','comp_leave']:
        aid=new_leave(kind,'2026-09-04')
        sql(AUTH+"select submit_application("+str(aid)+");")
        sql(ADMIN+"select review_application("+str(aid)+",'"+decision+"','local review');")
        if decision=='revision_required': sql(AUTH+"select reopen_application_draft("+str(aid)+");")
half=paid('2026-09-05',0.5,'am')
sql(AUTH+"select submit_application("+str(half)+");")
sql(ASSERT+ADMIN+"select pg_temp.denied($q$select review_application("+str(half)+",'approved')$q$,'attendance_half_day_sync_not_supported');")
sql(ASSERT+"select pg_temp.ok('failed approval rollback',(select status='submitted' from applications where id="+str(half)+") and (select remaining_days=19 from paid_leave_balances where employee_id=1));")
half_comp=new_leave('comp_leave','2026-09-07',0.5)
sql(AUTH+"select submit_application("+str(half_comp)+");")
sql(ASSERT+ADMIN+"select pg_temp.denied($q$select review_application("+str(half_comp)+",'approved')$q$,'attendance_half_day_sync_not_supported');")
sql(ASSERT+"select pg_temp.ok('half comp rollback',(select status='submitted' from applications where id="+str(half_comp)+") and (select used_days=1 from holiday_work_records where work_date='2026-08-01'));")
# Direct usage is a balance ledger, even for 2.25 days on one date. It must
# neither exempt that calendar day nor create attendance.
ledger=int(sql(ADMIN+"select register_admin_comp_leave_usage(1,'2026-09-23',2.25,'10000000-0000-0000-0000-000000000001');").strip())
sql(ASSERT+AUTH+"select pg_temp.ok('ledger does not exempt working day',exists(select 1 from jsonb_array_elements(check_driving_report_month('2026-10-01')->'days') d where d->>'date'='2026-09-23' and (d->>'required')::boolean));")
sql(ASSERT+"select pg_temp.ok('ledger is not attendance',not exists(select 1 from attendance where source_application_id="+str(ledger)+"));")
sql(AUTH+"insert into driving_reports(employee_id,report_date,driving_status) values(1,'2026-09-23','no_driving');")
# Confirm exact business definitions against the previously captured production
# prosrc, when available. No credentials, catalog bodies or production rows print.
import json,re
catalog_path=pathlib.Path('/private/tmp/kazu-month-production-catalog-review.json')
if catalog_path.exists():
    catalog=json.loads(catalog_path.read_text())
    selected=['set_application_printed','sync_application_attendance_date','sync_approved_application_attendance',
              'handle_application_attendance_status','register_admin_comp_leave_usage','update_admin_comp_leave_usage',
              'delete_admin_comp_leave_usage','submit_application','review_application','cancel_application']
    for name in selected:
        expected=next(f['body'] for f in catalog['functions'] if f['name']==name)
        actual=sql("select prosrc from pg_proc where oid='public."+name+"'::regproc;")
        assert re.findall(r"'(?:''|[^'])*'|\S",expected)==re.findall(r"'(?:''|[^'])*'|\S",actual), 'production body drift: '+name
    relations=['applications','paid_leave_application_details','comp_leave_application_details',
               'comp_leave_dates','holiday_work_records','comp_leave_allocations',
               'paid_leave_balances','paid_leave_balance_transactions']
    for name in relations:
        expected=next(r for r in catalog['relations'] if r['name']==name)
        columns=json.loads(sql("select jsonb_object_agg(attname,jsonb_build_array(format_type(atttypid,atttypmod),attnotnull)) from pg_attribute where attrelid='public."+name+"'::regclass and attnum>0 and not attisdropped;"))
        assert columns=={c['name']:[c['type'],c['notnull']] for c in expected['columns']}, 'production column drift: '+name
        actual=json.loads(sql("select coalesce(jsonb_object_agg(conname,pg_get_constraintdef(oid)),'{}') from pg_constraint where conrelid='public."+name+"'::regclass;"))
        for constraint in expected['constraints']:
            assert constraint['name'] in actual, 'missing production constraint: '+constraint['name']
            assert re.findall(r"'(?:''|[^'])*'|\S",constraint['definition'])==re.findall(r"'(?:''|[^'])*'|\S",actual[constraint['name']]), 'production constraint drift: '+constraint['name']
    print('PASS integration: 10 production function bodies and 8 application/balance table columns/constraints match captured read-only catalog.')
    print('UNVERIFIED: comp_leave_expirations production table constraints were not included in the captured catalog; canonical repository migration tested.')
else:
    print('UNVERIFIED: production catalog snapshot unavailable; repository migration bodies only.')
sql(ASSERT+AUTH+"select pg_temp.ok('ready with full leave and ledger',(check_driving_report_month('2026-10-01')->>'valid')::boolean);")
sql(AUTH+"select submit_driving_report_month('2026-10-01');")
# Printing remains administrator-only, including while a monthly gate is held.
proc=held("select submit_driving_report_month('2026-10-01');")
sql(ADMIN+"select set_application_printed("+str(paid_id)+",true); select set_application_printed("+str(comp_id)+",true);")
release(proc)
sql(ASSERT+"select pg_temp.ok('printed approved applications',(select count(*)=2 from applications where id in ("+str(paid_id)+","+str(comp_id)+") and printed_at is not null and printed_by_employee_id=3));")
sql(ADMIN+"select set_application_printed("+str(paid_id)+",false);")
sql(ASSERT+AUTH+"select pg_temp.denied($q$select set_application_printed("+str(comp_id)+",false)$q$,'admin_required');")
for change in ["update applications set employee_id=2 where id="+str(paid_id),
               "update applications set applicant_note='changed',printed_at=now() where id="+str(paid_id),
               "update applications set created_at=created_at+interval '1 day' where id="+str(paid_id),
               "update paid_leave_application_details set end_date='2026-09-24' where application_id="+str(paid_id),
               "update comp_leave_dates set leave_date='2026-09-24' where application_id="+str(comp_id)]:
    sql(ASSERT+OWNER+"select pg_temp.denied($q$"+change+"$q$,'driving_month_application_locked');")
for aid in [paid_id,comp_id]:
    sql(ASSERT+ADMIN+"select pg_temp.denied($q$select cancel_application("+str(aid)+",'blocked')$q$,'driving_month_application_locked');")
sql(ASSERT+"select pg_temp.ok('cancel rollback keeps paid balance',(select remaining_days=19 from paid_leave_balances where employee_id=1));")
# Ledger-only maintenance stays available after submission (no work/leave edit).
sql(ADMIN+"select update_admin_comp_leave_usage("+str(ledger)+",1,'2026-09-23',0.5,'balance correction'); select delete_admin_comp_leave_usage("+str(ledger)+",1); select register_admin_comp_leave_usage(1,'2026-09-23',1,'10000000-0000-0000-0000-000000000002'); select set_paid_leave_opening_balance(1,2026,21,0,0,0,'2026-04-01'); select register_admin_paid_leave_usage(1,'2026-09-23',0.5,'10000000-0000-0000-0000-000000000003');")
sql(ASSERT+"select pg_temp.ok('paid unrelated adjustment retained',(select remaining_days=19.5 from paid_leave_balances where employee_id=1)); select pg_temp.ok('comp ledger adjustment retained',(select used_days=2 from holiday_work_records where work_date='2026-08-01')); select pg_temp.ok('actual submitted leave unchanged',(select count(*)=2 from applications where id in ("+str(paid_id)+","+str(comp_id)+") and status='approved'));")
sql(ASSERT+OWNER+"select pg_temp.denied($q$update comp_leave_dates set admin_direct=false where application_id=(select id from applications where reviewer_comment='admin_comp_usage:10000000-0000-0000-0000-000000000002')$q$,'driving_month_application_locked');")
print('PASS integration: real approval/cancel/reject/revision, full-day leave sync, half-day rollback, paid/comp balances, 2.25/0.5/1 direct usage, print-only updates under monthly lock, submitted business changes rejected, owner-internal sync after helper ACL restriction.')
# Expiry boundary uses the real database JST date, not the isolated monthly
# eligibility clock. A credit remains valid through work_date + one year.
sql(ADMIN+"""
select register_holiday_work(2,((statement_timestamp() at time zone 'Asia/Tokyo')::date-interval '1 year')::date,1,null,'expiry-boundary');
select register_holiday_work(2,((statement_timestamp() at time zone 'Asia/Tokyo')::date-interval '1 year'-interval '1 day')::date,2,null,'expiry-old');
select * from expire_comp_leave_records();
""")
sql(ASSERT+"""
select pg_temp.ok('expiry one-year inclusive',(select remaining_days=1 and expired_days=0 from holiday_work_records where employee_id=2 and note='expiry-boundary'));
select pg_temp.ok('expiry next-day ledger',(select remaining_days=0 and expired_days=2 from holiday_work_records where employee_id=2 and note='expiry-old') and exists(select 1 from comp_leave_expirations where employee_id=2));
""")
sql(ASSERT+ADMIN+"select pg_temp.denied($q$select register_admin_comp_leave_usage(2,(statement_timestamp() at time zone 'Asia/Tokyo')::date+1,0.5,'10000000-0000-0000-0000-000000000004')$q$,'現在の代休残日数を超えています');")
sql(ASSERT+AUTH+"select pg_temp.denied($q$select register_admin_comp_leave_usage(1,'2026-09-23',0.5,'10000000-0000-0000-0000-000000000005')$q$,'残数管理権限が必要です');")
# Actual approval holds the monthly gate; submission waits, then revalidates the
# committed leave. In the opposite direction cancellation fails fast, without
# leaving half-reverted balances/attendance. No sleep-based success criterion.
sql("insert into holidays(date,day_type) select d,'休日' from generate_series(date '2026-08-21',date '2026-09-20',interval '1 day') d; update holidays set day_type='出勤' where date='2026-09-06';")
concurrent=paid('2026-09-06')
sql(AUTH+"select submit_application("+str(concurrent)+");")
proc=held("select review_application("+str(concurrent)+",'approved');",ADMIN)
peer=worker("select submit_driving_report_month('2026-09-01');",'real_review_then_month')
wait_lock('real_review_then_month');release(proc)
assert peer.wait(timeout=10)==0,peer.stderr.read()
proc=held("select submit_driving_report_month('2026-09-01');")
sql(ASSERT+ADMIN+"select pg_temp.denied($q$select cancel_application("+str(concurrent)+",'concurrent')$q$,'driving_month_busy_retry');")
release(proc)
sql(ASSERT+"select pg_temp.ok('concurrent leave retained',(select status='approved' from applications where id="+str(concurrent)+") and exists(select 1 from attendance where source_application_id="+str(concurrent)+") and (select remaining_days=18.5 from paid_leave_balances where employee_id=1));")
print('PASS integration: actual one-year expiry boundary/ledger, post-expiry usage refusal, non-manager refusal, real review/month-submit contention and cancellation rollback; no deadlock observed.')
print('Retained production-equivalent application integration DB:',DB)

# Differential migration: reproduce actual saved holiday drafts, then apply ONLY
# the new check-RPC body in the already isolated integration database.
print('Checking calendar-holiday draft differential migration...')
sql("insert into holidays(date,day_type) select d,'休日' from generate_series(date '2026-06-21',date '2026-07-20',interval '1 day') d; update holidays set day_type='出勤' where date='2026-06-21'; update holidays set day_type='祝日' where date='2026-06-23';")
sql(OWNER+"""
insert into attendance(employee_id,work_date,site_type,leave_type,status) values
(1,'2026-06-22','休み','休日','draft'),(1,'2026-06-23','休み','休日','draft'),
(1,'2026-06-24','休み','休日','draft'),(1,'2026-06-27','会社勤務','','draft'),
(1,'2026-06-28','休み','有給','draft'),(1,'2026-06-29','休み','休日','draft'),
(1,'2026-07-03','休み','休日','draft'),(1,'2026-07-04','休み','休日','draft'),
(1,'2026-07-05','休み','休日','draft'),(1,'2026-07-05','休み','休日','draft');
update attendance set start_time='08:00' where work_date='2026-06-24';
-- Owner-created legacy inconsistent fixture; use the existing internal-sync guard.
select set_config('app.application_attendance_sync','on',false);
update attendance set source_type='application',source_application_id=(select min(id) from applications where employee_id=1 and status='approved') where work_date='2026-06-29';
select set_config('app.application_attendance_sync','off',false);
""")
sql(AUTH+"insert into driving_reports(employee_id,report_date,driving_status) values(1,'2026-06-26','no_driving');")
sql(ADMIN+"select register_holiday_work(1,'2026-06-25',1); select register_holiday_work(1,'2026-07-03',1); select register_holiday_work(1,'2026-07-04',1); select cancel_holiday_work(id) from holiday_work_records where work_date='2026-07-04';")
sql(ASSERT+AUTH+"select pg_temp.ok('old defect reproduced',exists(select 1 from jsonb_array_elements(check_driving_report_month('2026-07-01')->'errors') x where x->>'date'='2026-06-22' and x->>'code'='work_unconfirmed'));")
metadata_query="select jsonb_build_object('owner',proowner,'acl',proacl,'definer',prosecdef,'config',proconfig,'args',pg_get_function_identity_arguments(oid),'result',pg_get_function_result(oid)) from pg_proc where oid='public.check_driving_report_month(date)'::regprocedure;"
before_metadata=sql(metadata_query)
sql((ROOT/'supabase/fix_driving_month_calendar_holiday_attendance.sql').read_text())
assert sql(metadata_query)==before_metadata,'Differential changed function security/signature'
sql(ASSERT+AUTH+"""
select pg_temp.ok('holiday draft + national holiday exempt',(select count(*)=2 from jsonb_array_elements(check_driving_report_month('2026-07-01')->'days') d where d->>'date' in ('2026-06-22','2026-06-23') and d->>'reason'='company_holiday' and not (d->>'required')::boolean and d->>'issue' is null));
select pg_temp.ok('calendar workday required even Sunday',exists(select 1 from jsonb_array_elements(check_driving_report_month('2026-07-01')->'errors') d where d->>'date'='2026-06-21' and d->>'code'='report_missing'));
select pg_temp.ok('saved holiday report included',exists(select 1 from jsonb_array_elements(check_driving_report_month('2026-07-01')->'days') d where d->>'date'='2026-06-26' and (d->>'required')::boolean and d->>'issue' is null));
select pg_temp.ok('holiday work needs report',exists(select 1 from jsonb_array_elements(check_driving_report_month('2026-07-01')->'errors') d where d->>'date'='2026-06-25' and d->>'code'='report_missing'));
select pg_temp.ok('work + holiday rest contradiction retained',exists(select 1 from jsonb_array_elements(check_driving_report_month('2026-07-01')->'errors') d where d->>'date'='2026-07-03' and d->>'code'='holiday_work_attendance_conflict'));
select pg_temp.ok('cancelled holiday work ignored',exists(select 1 from jsonb_array_elements(check_driving_report_month('2026-07-01')->'days') d where d->>'date'='2026-07-04' and d->>'reason'='company_holiday' and d->>'issue' is null));
select pg_temp.ok('unknown work/leave/link/dirty row retained',(select count(*)=4 from jsonb_array_elements(check_driving_report_month('2026-07-01')->'errors') d where d->>'date' in ('2026-06-24','2026-06-27','2026-06-28','2026-06-29') and d->>'code'='work_unconfirmed'));
select pg_temp.ok('duplicate rest rows not silently exempt',exists(select 1 from jsonb_array_elements(check_driving_report_month('2026-07-01')->'errors') d where d->>'date'='2026-07-05' and d->>'code'='work_leave_conflict'));
select pg_temp.ok('approved full paid + comp still exempt',(select count(*)=2 from jsonb_array_elements(check_driving_report_month('2026-10-01')->'days') d where d->>'date' in ('2026-09-21','2026-09-22') and d->>'reason'='approved_full_leave' and d->>'issue' is null));
select pg_temp.denied($q$update driving_reports set note='blocked' where report_date='2026-09-23'$q$,'driving_month_already_submitted');
""")
sql("delete from holidays where date='2026-06-22';")
sql(ASSERT+AUTH+"select pg_temp.ok('no calendar must remain unknown',exists(select 1 from jsonb_array_elements(check_driving_report_month('2026-07-01')->'errors') d where d->>'date'='2026-06-22' and d->>'code'='work_unconfirmed'));")
print('PASS calendar differential: real defect reproduced, rest drafts/holidays exempt only with exact clean calendar match; workdays/reports/holiday-work/leave/unknown/conflicts preserved; ACL/owner/signature unchanged; submitted edit guard retained.')
