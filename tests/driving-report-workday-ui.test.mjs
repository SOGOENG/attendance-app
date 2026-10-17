// Local browser + mocked REST API only. Never connects to production.
// PLAYWRIGHT_MODULE and BROWSER_PATH may point to installed Playwright / Chrome.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const root = fileURLToPath(new URL('../', import.meta.url));
const definitionSQL = await readFile(join(root,'supabase/add_driving_report_submission.sql'),'utf8');
const items = [...definitionSQL.matchAll(/\('([a-z_]+)', '([^']+)', (\d+)\)/g)].map(m=>({inspection_item_code:m[1],display_name:m[2],display_order:Number(m[3])}));
assert.equal(items.length,13);
const server=createServer(async(req,res)=>{
 const file=new URL(req.url,'http://localhost').pathname.slice(1);
 if(!/^[a-z0-9.-]+$/i.test(file)){res.writeHead(404);return res.end();}
 try {res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html; charset=utf-8');res.end(await readFile(join(root,file)));}catch{res.writeHead(404);res.end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,...(process.env.BROWSER_PATH?{executablePath:process.env.BROWSER_PATH}:{})});


try {
 const page=await browser.newPage({viewport:{width:1280,height:900},timezoneId:'America/Los_Angeles'}),errors=[],calls=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.clock.install({time:new Date('2026-10-21T12:00:00+09:00')});
 await page.route('**/portal-auth.js',r=>r.fulfill({contentType:'text/javascript',body:'const PORTAL_SUPABASE_URL="https://mock.invalid";window.portalFetch=(url,opts)=>fetch(url,opts);'}));
 const attendance=(date,type,status='submitted',extra={})=>({employee_id:7,work_date:date,site_type:type,status,...extra});
 const rows=[attendance('2026-09-21','一般'),attendance('2026-09-22','一般'),attendance('2026-09-23','会社勤務'),attendance('2026-09-24','一般'),attendance('2026-09-25','一般','draft'),attendance('2026-09-28','休み','draft',{source_type:'application',source_application_id:1,leave_type:'有給'}),attendance('2026-09-29','休み','draft',{source_type:'application',source_application_id:2,leave_type:'代休'}),attendance('2026-09-30','休み','draft',{source_type:'application',source_application_id:3,leave_type:'有給'}),attendance('2026-10-01','一般'),attendance('2026-10-20','一般'),attendance('2026-10-21','一般'),{employee_id:999,work_date:'2026-09-26',site_type:'一般',status:'submitted'}];
 const apps=[{id:1,employee_id:7,status:'approved',application_type:'paid_leave',paid_leave_application_details:{start_date:'2026-09-28',end_date:'2026-09-28',day_part:'full',days:1}},{id:2,employee_id:7,status:'approved',application_type:'comp_leave',comp_leave_application_details:{comp_leave_dates:[{leave_date:'2026-09-29',days:1}]}},{id:3,employee_id:7,status:'approved',application_type:'paid_leave',paid_leave_application_details:{start_date:'2026-09-30',end_date:'2026-09-30',day_part:'am',days:.5}},{id:4,employee_id:7,status:'approved',application_type:'paid_leave',paid_leave_application_details:{start_date:'2026-10-01',end_date:'2026-10-01',day_part:'full',days:1}}];
 const holidays=[{date:'2026-09-21',day_type:'出勤'},{date:'2026-09-22',day_type:'休日'},{date:'2026-09-23',day_type:'祝日'},{date:'2026-09-24',day_type:'出勤'},{date:'2026-09-27',day_type:'休日'}];
 let failHoliday=false,failAttendance=false,failApps=false;
 await page.route('https://mock.invalid/**',async route=>{
  const req=route.request(),url=new URL(req.url()),table=url.pathname.split('/').at(-1);calls.push({table,method:req.method(),url:url.href});
  const reply=(data,fail=false)=>route.fulfill({status:fail?403:200,json:fail?{error:'denied'}:data});
  if(table==='current_employee_id')return reply(7);
  if(table==='holidays')return reply(holidays,failHoliday);
  if(table==='attendance')return reply(rows,failAttendance);
  if(table==='applications')return reply(apps,failApps);
  if(table==='driving_reports')return reply([{id:1,employee_id:7,report_date:'2026-09-23',status:'submitted',driving_status:'no_driving'},{id:2,employee_id:7,report_date:'2026-09-24',status:'draft',driving_status:'driven'}]);
  throw Error('Unexpected '+table);
 });
 await page.goto('http://127.0.0.1:'+server.address().port+'/driving-report-month.html');await page.waitForSelector('.monthly-day');
 // Today and future are never late, even if work is submitted.
 assert.equal(await page.locator('[data-date="2026-10-21"]').getAttribute('data-work'),'today');
 assert.equal(await page.locator('[data-date="2026-10-22"]').getAttribute('data-work'),'future');
 await page.locator('#closingMonth').selectOption('2026-10');await page.waitForSelector('[data-date="2026-09-21"]');
 const day=date=>page.locator(`[data-date="${date}"]`);
 assert.equal(await day('2026-09-21').getAttribute('data-work'),'unsubmitted');
 assert((await day('2026-09-21').textContent()).includes('勤務日（出勤）'));
 assert.equal(await day('2026-09-22').getAttribute('data-work'),'unsubmitted');assert((await day('2026-09-22').textContent()).includes('会社休日'));assert(await day('2026-09-22').locator('a').isVisible());
 assert.equal(await day('2026-09-23').getAttribute('data-work'),'complete');assert((await day('2026-09-23').textContent()).includes('運転なし'));assert.equal(await day('2026-09-23').locator('a').innerText(),'詳細確認');
 assert.equal(await day('2026-09-24').getAttribute('data-work'),'unsubmitted');assert.equal(await day('2026-09-24').locator('a').innerText(),'続きから入力');
 assert.equal(await day('2026-09-25').getAttribute('data-work'),'unknown');
 assert((await day('2026-09-26').textContent()).includes('土曜日'));assert.equal(await day('2026-09-26').getAttribute('data-work'),'unknown');
 assert((await day('2026-09-27').textContent()).includes('日'));assert.equal(await day('2026-09-27').getAttribute('data-work'),'unknown');
 assert.equal(await day('2026-09-28').getAttribute('data-work'),'exempt');assert((await day('2026-09-28').textContent()).includes('全日有給確定'));
 assert.equal(await day('2026-09-29').getAttribute('data-work'),'exempt');assert((await day('2026-09-29').textContent()).includes('全日代休確定'));
 assert.equal(await day('2026-09-30').getAttribute('data-work'),'unknown');assert((await day('2026-09-30').textContent()).includes('半日休暇'));
 assert.equal(await day('2026-10-01').getAttribute('data-work'),'unknown');
 assert.equal(await day('2026-10-20').getAttribute('data-work'),'unsubmitted');assert.equal(await day('2026-10-21').count(),0);
 const counts=await page.locator('#monthlyCounts').innerText();
 for(const width of [1280,390,320]){await page.setViewportSize({width,height:900});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:join(tmpdir(),`driving-workday-${width}.png`),fullPage:true});}
 const reload=async()=>{await page.locator('#reloadMonth').click();await page.waitForFunction(()=>!document.getElementById('reloadMonth').disabled);};
 failHoliday=true;await reload();assert((await day('2026-09-22').textContent()).includes('休日設定を取得できません'));assert(await day('2026-09-22').locator('a').isVisible());assert.equal(await page.locator('#monthlyCounts').innerText(),counts);
 failAttendance=true;await reload();assert.equal(await day('2026-09-21').getAttribute('data-work'),'unknown');failAttendance=false;failApps=true;await reload();assert.equal(await day('2026-09-28').getAttribute('data-work'),'unknown');
 assert(calls.filter(c=>['attendance','applications','driving_reports'].includes(c.table)).every(c=>new URL(c.url).searchParams.get('employee_id')==='eq.7'));
 assert(calls.every(c=>c.method==='GET'||c.table==='current_employee_id'));assert.deepEqual(errors,[]);
 console.log('PASS holiday/workday integration: company calendar separate from actual work, confirmed work/missing/draft/submitted, holiday work, weekend unknown, approved full paid/comp leave, half leave unknown, contradictory/foreign data, source failures, today/future, period boundaries, counts retained, PC/390/320. Mock APIs only.');
} finally {await browser.close();await new Promise(r=>server.close(r));}
