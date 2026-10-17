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
 await page.clock.install({time:new Date('2026-10-21T00:00:00+09:00')});
 await page.addInitScript(()=>localStorage.setItem('portalLoginUser',JSON.stringify({id:999,name:'偽の社員'})));
 await page.route('**/portal-auth.js',r=>r.fulfill({contentType:'text/javascript',body:'const PORTAL_SUPABASE_URL="https://mock.invalid";window.portalFetch=(url,opts)=>fetch(url,opts);window.redirectToPortalLogin=()=>{};'}));
 let fail=false;
 await page.route('https://mock.invalid/**',async route=>{
  const req=route.request(),url=new URL(req.url()),table=url.pathname.split('/').at(-1);calls.push({table,method:req.method(),url:url.href});
  if(['holidays','attendance','applications'].includes(table))return route.fulfill({json:[]});
  if(table==='current_employee_id')return route.fulfill({json:7});
  if(table==='driving_reports'){
   if(fail)return route.fulfill({status:500,json:{message:'mock failure'}});
   if(url.searchParams.get('report_date')?.startsWith('eq.')){
    const date=url.searchParams.get('report_date').slice(3);
    return route.fulfill({json:date==='2026-10-19'?[]:[{id:1,employee_id:7,report_date:date,status:date==='2026-10-20'?'draft':'submitted',driving_status:date==='2026-10-20'?'driven':'no_driving',start_odometer:date==='2026-10-20'?100:null}]});
   }
   return route.fulfill({json:[{id:1,employee_id:7,report_date:'2026-10-21',status:'submitted',driving_status:'no_driving'},{id:2,employee_id:7,report_date:'2026-10-20',status:'draft',driving_status:'driven'},{id:9,employee_id:999,report_date:'2026-10-22',status:'submitted',driving_status:'driven'}]});
  }
  if(table==='employees')return route.fulfill({json:[{id:7,name:'本人',department:'工事部',default_vehicle_id:null}]});
  if(table==='driving_report_inspection_items')return route.fulfill({json:items});
  if(table==='vehicles'||table==='sites'||table==='driving_report_inspections'||table==='driving_alcohol_checks'||table==='driving_refuels')return route.fulfill({json:[]});
  throw Error('Unexpected '+table);
 });
 const base='http://127.0.0.1:'+server.address().port;
 await page.goto(base+'/driving-report-month.html?employee_id=999');
 await page.waitForSelector('.monthly-day');
 assert.equal(await page.locator('#closingMonth').inputValue(),'2026-11');
 assert.equal(await page.locator('#previousMonth,#nextMonth').count(),0);
 assert.equal(await page.locator('#closingMonth').evaluate(node=>node.tagName),'SELECT');
 assert.equal(await page.locator('#closingMonth option').first().innerText(),'2026年11月');
 assert.equal(await page.locator('#closingMonth option[value="2026-12"]').count(),0);
 assert.equal(await page.locator('.monthly-overview .driving-help').count(),0);
 assert.equal(await page.locator('#todayReport').getAttribute('href'),'driving-report.html?date=2026-10-21');

 assert((await page.locator('#monthlyPeriod').innerText()).includes('期間：10/21〜11/20'));
 assert.equal(await page.locator('.monthly-day').count(),31);
 assert.equal(await page.locator('[data-state="submitted"]').count(),1);
 assert((await page.locator('[data-date="2026-10-21"]').innerText()).includes('運転なし'));
 assert.equal(await page.locator('[data-state="future"]').count(),30);
 assert.equal(await page.locator('[data-state="future"] a').count(),0);
 assert((await page.locator('#monthlyCounts').innerText()).includes('記録なし 0件'));
 assert(calls.filter(c=>c.table==='driving_reports').every(c=>new URL(c.url).searchParams.get('employee_id')==='eq.7'));
 assert(!calls.some(c=>c.method!=='GET'&&c.table!=='current_employee_id'));
 await page.locator('#closingMonth').selectOption('2026-10');await page.waitForSelector('[data-date="2026-09-21"]');
 assert.equal(await page.locator('[data-state="draft"]').count(),1);assert.equal(await page.locator('[data-state="missing"]').count(),29);
 assert.equal(await page.locator('[data-state="draft"] a').getAttribute('href'),'driving-report.html?date=2026-10-20');
 for(const width of [1280,390,320]){await page.setViewportSize({width,height:900});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  const style=await page.locator('#todayReport').evaluate(node=>{const s=getComputedStyle(node);return {bg:s.backgroundColor,size:s.fontSize,height:node.getBoundingClientRect().height};});
  assert.equal(style.bg,'rgb(255, 255, 255)');
  for(const id of ['todayReport','reloadMonth']){
   const colors=await page.locator('#'+id).evaluate(node=>{const s=getComputedStyle(node);return [s.color,s.borderTopColor,s.borderTopWidth,s.borderTopStyle,s.backgroundColor];});
   assert.deepEqual(colors,['rgb(37, 99, 235)','rgb(37, 99, 235)','1px','solid','rgb(255, 255, 255)']);
  }
  const reloadStyle=await page.locator('#reloadMonth').evaluate(node=>({size:getComputedStyle(node).fontSize,height:node.getBoundingClientRect().height}));assert.equal(style.size,reloadStyle.size);assert.equal(style.height,reloadStyle.height);
  if(width<=390)assert.equal(await page.locator('#todayReport').evaluate(n=>n.getBoundingClientRect().width),await page.locator('.monthly-actions').evaluate(n=>n.getBoundingClientRect().width));
 }
 await page.locator('#closingMonth').selectOption('2026-01');await page.locator('#closingMonth').dispatchEvent('change');await page.waitForSelector('[data-date="2025-12-21"]');assert.equal(await page.locator('.monthly-day').count(),31);
 await page.locator('#closingMonth').selectOption('2024-03');await page.locator('#closingMonth').dispatchEvent('change');await page.waitForSelector('[data-date="2024-02-29"]');assert.equal(await page.locator('.monthly-day').count(),29);
 fail=true;await page.locator('#reloadMonth').click();await page.waitForFunction(()=>document.getElementById('monthlyCounts').textContent==='件数を確認できません');assert.equal(await page.locator('.monthly-day').count(),0);fail=false;

 await page.clock.setFixedTime(new Date('2027-01-10T00:00:00+09:00'));await page.goto(base+'/driving-report-month.html');await page.waitForSelector('.monthly-day');
 assert.equal(await page.locator('#monthlyPeriod').innerText(),'期間：2026/12/21〜2027/1/20');
 assert(await page.locator('#monthlyPeriod').evaluate(node=>node.scrollWidth<=node.clientWidth));
 await page.clock.setFixedTime(new Date('2026-10-21T00:00:00+09:00'));
 await page.goto(base+'/driving-report.html?date=2026-10-21&employee_id=999');await page.waitForFunction(()=>document.getElementById('drivingMessage').textContent.includes('提出済み'));
 assert.equal(await page.locator('#reportDate').inputValue(),'2026-10-21');assert(await page.locator('#drivingEditor').evaluate(node=>node.disabled));assert(await page.locator('#saveDraft').isDisabled());
 await page.goto(base+'/driving-report.html?date=2026-10-20');await page.waitForFunction(()=>document.getElementById('drivingMessage').textContent.includes('下書きを読み込み'));
 assert.equal(await page.locator('#reportDate').inputValue(),'2026-10-20');assert.equal(await page.locator('#startOdometer').inputValue(),'100');assert(await page.locator('#startOdometer').isEnabled());
 await page.goto(base+'/driving-report.html?date=2026-10-19');await page.waitForFunction(()=>document.getElementById('drivingMessage').textContent.includes('新しく入力できます'));
 assert.equal(await page.locator('#reportDate').inputValue(),'2026-10-19');assert(!calls.some(c=>c.table==='driving_reports'&&c.method!=='GET'));
 for(const date of ['2026-02-30','2026-10-22','2026-1-01','bad','2026-10-20&date=2026-10-21','']){
  const count=calls.length;await page.goto(base+'/driving-report.html?date='+date);await page.waitForFunction(()=>document.getElementById('drivingMessage').textContent.includes('URLの日付'));
  assert(await page.locator('#saveDraft').isDisabled());assert.equal(calls.length,count);
 }
 assert.deepEqual(errors,[]);
 console.log('PASS personal monthly list: JST closing month, 21–20, year rollover/leap day, own employee RPC/filter, foreign rows ignored, no-driving submitted, draft/missing/future, no writes, date navigation, submitted lock, invalid/future/duplicate date rejected, fetch failure, PC/390/320. APIs mocked.');
} finally {await browser.close();await new Promise(r=>server.close(r));}
