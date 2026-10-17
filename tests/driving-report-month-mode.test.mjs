// Pure local checks. No browser, credentials, network or database.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const source=await readFile(new URL('../driving-report-month-mode.js',import.meta.url),'utf8');
const period=await readFile(new URL('../driving-report-period.js',import.meta.url),'utf8');
const company='https://fgmvmbjnoyagnpygcbky.supabase.co';
function setup(api=company,hostname='127.0.0.1',search='',today='2026-10-21'){
 const calls=[],context={URL,URLSearchParams,Intl,Date,location:{hostname,search},PORTAL_SUPABASE_URL:api,
  portalFetch:async(url,opts)=>{calls.push({url,body:JSON.parse(opts.body)});return {ok:true,json:async()=>({})};}};
 context.window=context;vm.createContext(context);vm.runInContext(period,context);context.DrivingReportPeriod.today=()=>today;
 vm.runInContext(source,context);return {mode:context.DrivingReportMonthMode,calls};
}
for(const host of ['localhost','127.0.0.1','[::1]','192.168.11.16'])assert(setup(company,host).mode.enabled);
for(const api of ['https://other.supabase.co',company+'/unexpected',company.replace('https:','http:'),'https://user:password@fgmvmbjnoyagnpygcbky.supabase.co'])assert(!setup(api).mode.enabled);
assert(!setup(company,'unapproved.example','?mode=monthly').mode.enabled);
assert(!setup('http://127.0.0.1:54321').mode.enabled);
assert(setup('http://127.0.0.1:54321','localhost','?mode=monthly').mode.enabled);
assert(setup(company).mode.link('2026-10-19').endsWith('&mode=monthly'));
let env=setup(company,'localhost','','2026-10-20');
await assert.rejects(()=>env.mode.rpc('submit_driving_report_month','2026-10'));
assert.equal(env.calls.length,0);
env=setup();
await assert.rejects(()=>env.mode.rpc('submit_driving_report_month','2026-09'));
await assert.rejects(()=>env.mode.rpc('submit_driving_report_month','2026-13'));
await assert.rejects(()=>env.mode.rpc('submit_driving_report','2026-10'));
assert.equal(env.calls.length,0);
await env.mode.rpc('check_driving_report_month','2026-10');
await env.mode.rpc('submit_driving_report_month','2026-10');
assert.deepEqual(env.calls.map(c=>c.body),[{p_closing_month:'2026-10-01'},{p_closing_month:'2026-10-01'}]);
console.log('PASS monthly mode: exact company allowlist, local-page restriction, default enablement, mock opt-in, October floor, 20/21, date validation, RPC allowlist. No network.');
