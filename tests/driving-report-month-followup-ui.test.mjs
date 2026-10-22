// Local Chrome + fully mocked API. Never connects to Supabase.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {pathToFileURL} from 'node:url';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:'playwright');
const server=createServer(async(req,res)=>{const file=new URL(req.url,'http://localhost').pathname.slice(1);if(!/^[a-z0-9.-]+$/i.test(file)){res.writeHead(404);return res.end();}try{res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html; charset=utf-8');res.end(await readFile(new URL('../'+file,import.meta.url)));}catch{res.writeHead(404);res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_PATH});
try{
 const page=await browser.newPage({viewport:{width:390,height:844},timezoneId:'America/Los_Angeles'}),errors=[],calls=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.clock.install({time:new Date('2026-10-10T00:00:00+09:00')});
 await page.route('**/portal-auth.js',r=>r.fulfill({contentType:'text/javascript',body:'const PORTAL_SUPABASE_URL="http://127.0.0.1:54321";window.portalFetch=(url,opts)=>fetch(url,opts);'}));
 let submitted=false,fail=false;
 const reports=[{id:1,employee_id:7,report_date:'2026-09-22',status:'draft'},{id:2,employee_id:7,report_date:'2026-09-28',status:'draft'}];
 await page.route('http://127.0.0.1:54321/**',async route=>{
  const req=route.request(),url=new URL(req.url()),name=url.pathname.split('/').at(-1);calls.push({name,method:req.method()});
  if(name==='current_employee_id')return route.fulfill({json:7});
  if(['holidays','attendance','applications'].includes(name))return route.fulfill({json:[]});
  if(name==='driving_reports')return route.fulfill({json:reports});
  if(name==='check_driving_report_month'){
   if(fail)return route.fulfill({status:500,json:{message:'failed'}});
   const month=req.postDataJSON().p_closing_month.slice(0,7);
   const data=await page.evaluate(month=>{const p=DrivingReportPeriod,span=p.range(month);return {closing_month:month+'-01',period_start:span.start,period_end:span.end,eligible:p.today()>span.end,valid:true,already_submitted:false,days:span.days.map(date=>({date,required:false,reason:'company_holiday',report_id:null,status:null,issue:null})),errors:[]};},month);
   const overrides={
    '2026-09-21':{required:true,issue:'report_missing'},
    '2026-09-22':{required:true,report_id:1,status:'draft',issue:'all_13_official_inspections_required'},
    '2026-09-23':{issue:'half_or_ambiguous_leave'},
    '2026-09-25':{reason:'approved_full_leave'},
    '2026-09-26':{required:true,reason:'half_leave_work',issue:'report_missing'},
    '2026-09-27':{required:true,reason:'active_holiday_work',issue:'report_missing'},
    '2026-09-28':{required:true,report_id:2,status:'draft'},
    '2026-09-29':{issue:'work_leave_conflict'},
    '2026-10-09':{required:true,issue:'report_missing'},'2026-10-10':{required:true,issue:'report_missing'},
    '2026-10-11':{required:true,issue:'report_missing'},'2026-10-20':{required:true,issue:'report_missing'},
    '2026-10-21':{required:true,issue:'report_missing'},'2026-12-31':{required:true,issue:'report_missing'},
    '2027-01-01':{reason:'approved_full_leave'}
   };
   for(const day of data.days){Object.assign(day,overrides[day.date]||{});if(day.issue)data.errors.push({date:day.date,code:day.issue});}
   data.valid=data.errors.length===0;data.already_submitted=submitted;return route.fulfill({json:data});
  }
  throw Error('Unexpected API '+name);
 });
 const url='http://127.0.0.1:'+server.address().port+'/driving-report-month.html?mode=monthly';
 const ready=()=>page.waitForFunction(()=>document.getElementById('monthlyMessage').textContent.startsWith('本人の日報を表示'));
 await page.goto(url);await ready();
 assert((await page.locator('#monthlyCounts').innerText()).includes('記録なし 18件'));
 assert((await page.locator('#monthlyFollowupCounts').innerText()).includes('記入忘れ 5日（未入力 4日／入力未完了 1日）／勤務等の要確認 2日'));
 assert((await page.locator('[data-date="2026-10-10"]').innerText()).includes('入力待ち'));
 assert.equal(await page.locator('[data-date="2026-10-11"] a').count(),0);
 for(const date of ['2026-09-24','2026-09-25'])assert.equal(await page.locator(`[data-date="${date}"]`).getAttribute('data-followup'),'exempt');
 assert.equal(await page.locator('[data-date="2026-09-28"]').getAttribute('data-followup'),'ready');
 assert((await page.locator('[data-date="2026-09-22"] .monthly-followup').innerText()).includes('点検13項目'));
 assert.equal(await page.locator('[data-date="2026-09-22"] a').getAttribute('href'),'driving-report.html?date=2026-09-22&mode=monthly');
 await page.locator('#onlyActionNeeded').check();assert.equal(await page.locator('.monthly-day:visible').count(),7);
 assert.equal(await page.locator('[data-date="2026-10-10"]:visible').count(),0);
 for(const width of [1280,390,320]){await page.setViewportSize({width,height:900});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));}
 await page.clock.setFixedTime(new Date('2026-10-20T00:00:00+09:00'));await page.locator('#reloadMonth').click();await ready();
 assert.equal(await page.locator('#closingMonth').inputValue(),'2026-10');assert.equal(await page.locator('[data-date="2026-10-20"]').getAttribute('data-followup'),'today');assert(await page.locator('#submitMonth').isDisabled());
 await page.clock.setFixedTime(new Date('2026-10-21T00:00:00+09:00'));await page.reload();await ready();assert.equal(await page.locator('#closingMonth').inputValue(),'2026-11');
 assert((await page.locator('#monthlyFollowupCounts').innerText()).includes('記入忘れ 0日'));
 await page.locator('#closingMonth').selectOption('2026-10');await ready();
 assert((await page.locator('#monthSubmitSummary').innerText()).includes('提出時の全期間確認'));
 submitted=true;await page.locator('#reloadMonth').click();await ready();assert((await page.locator('#monthlyFollowupCounts').innerText()).includes('記入忘れ 0日'));assert(await page.locator('#submitMonth').isDisabled());
 assert.equal(await page.locator('[data-date="2026-09-21"] a').count(),0);
 submitted=false;await page.clock.setFixedTime(new Date('2027-01-10T00:00:00+09:00'));await page.reload();await ready();
 assert.equal(await page.locator('#monthlyPeriod').innerText(),'期間：2026/12/21〜2027/1/20');assert((await page.locator('#monthlyFollowupCounts').innerText()).includes('記入忘れ 1日'));
 fail=true;await page.locator('#reloadMonth').click();await page.waitForFunction(()=>document.getElementById('monthlyCounts').textContent==='件数を確認できません');assert(await page.locator('#onlyActionNeeded').isDisabled());assert.equal(await page.locator('.monthly-day').count(),0);
 assert(!calls.some(c=>!['current_employee_id','check_driving_report_month'].includes(c.name)&&c.method!=='GET'));assert.deepEqual(errors,[]);
 console.log('PASS followup UI: midmonth record/omission counts, RPC holiday/full/half leave, draft ready/incomplete, reasons/links/filter, today/future, 20/21, year rollover, submitted lock, failure and responsive widths.');
}finally{await browser.close();await new Promise(r=>server.close(r));}
