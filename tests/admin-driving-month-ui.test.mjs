// Local Chrome/mock APIs only. No production calls.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {pathToFileURL} from 'node:url';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:'playwright');
const server=createServer(async(req,res)=>{const f=new URL(req.url,'http://localhost').pathname.slice(1);if(!/^[a-z0-9.-]+$/i.test(f)){res.writeHead(404);return res.end();}try{res.setHeader('Content-Type',f.endsWith('.js')?'text/javascript':f.endsWith('.css')?'text/css':'text/html; charset=utf-8');res.end(await readFile(new URL('../'+f,import.meta.url)));}catch{res.writeHead(404);res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_PATH});
try{
 const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[],calls=[];
 page.on('pageerror',e=>errors.push(e.message));let admin=true,empty=false,fail=false,rosterChanged=false;
 await page.clock.install({time:new Date('2026-10-22T10:00:00+09:00')});
 await page.route('**/portal-auth.js',r=>r.fulfill({contentType:'text/javascript',body:'const PORTAL_SUPABASE_URL="https://mock.invalid";window.portalFetch=(url,opts)=>fetch(url,opts);'}));
 await page.route('https://mock.invalid/**',async route=>{
  const req=route.request(),name=new URL(req.url()).pathname.split('/').at(-1),body=req.postDataJSON();calls.push({name,body,method:req.method()});
  if(name==='is_application_admin')return route.fulfill({json:admin});
  if(fail)return route.fulfill({status:404,json:{code:'PGRST202'}});
  const month=body.p_closing_month.slice(0,7),span=await page.evaluate(m=>DrivingReportPeriod.range(m),month);
  const envelope={closing_month:body.p_closing_month,period_start:span.start,period_end:span.end};
  if(name==='admin_driving_month_status')return route.fulfill({json:{...envelope,actor_id:99,roster_token:(rosterChanged&&body.p_offset>0?'b':'a').repeat(32),total:empty?0:51,employees:empty?[]:Array.from({length:Math.min(50,51-body.p_offset)},(_,i)=>({id:body.p_offset+i+1,name:i?'社員':'<img src=x>',department:'工事部',active:true,submitted:i%2===1,submitted_at:i%2===1?'2026-10-21T00:00:00+09:00':null,missing:2,incomplete:1,review:1}))}});
  if(name==='admin_driving_month_days')return route.fulfill({json:{...envelope,employee:{id:body.p_employee_id,name:body.p_employee_id===99?'管理者本人':'社員',department:'工事部',active:true,driving_report_required:body.p_employee_id!==99},submitted:false,submitted_at:null,days:span.days.map((date,i)=>({date,status:'draft',required:true,issue:i===0?'all_13_official_inspections_required':null,reason:'confirmed_work',report_id:1,kind:i===0?'incomplete':'ready'}))}});
  throw Error('Unexpected API '+name);
 });
 const url='http://127.0.0.1:'+server.address().port+'/driving-report-status-admin.html';
 await page.goto(url);await page.waitForFunction(()=>document.getElementById('statusMessage').textContent.includes('対象 51人'));
 assert.equal(await page.locator('#statusEmployees tr').count(),51);assert.equal(await page.locator('#statusEmployees img').count(),0);
 assert.equal(calls.filter(c=>c.name==='admin_driving_month_status').length,2);
 await page.locator('#statusEmployees button').first().click();await page.waitForFunction(()=>document.getElementById('statusDays').children.length>0);
 assert((await page.locator('#statusDays').innerText()).includes('点検13項目'));
 assert.equal(await page.locator('#statusDetail input,#statusDetail textarea,#statusDetail a').count(),0);
 await page.locator('#viewOwnStatus').click();await page.waitForFunction(()=>document.getElementById('statusDetailTitle').textContent.includes('管理者本人'));
 assert((await page.locator('#statusDetailMessage').innerText()).includes('対象OFF'));
 for(const width of [1280,390,320]){await page.setViewportSize({width,height:900});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));}
 await page.locator('#statusMonth').fill('2027-01');await page.locator('#statusMonth').dispatchEvent('change');await page.waitForFunction(()=>document.getElementById('statusPeriod').textContent.includes('2026-12-21〜2027-01-20'));
 rosterChanged=true;await page.locator('#reloadStatus').click();await page.waitForFunction(()=>document.getElementById('statusMessage').textContent.includes('対象設定が変更'));assert.equal(await page.locator('#statusEmployees tr').count(),0);rosterChanged=false;
 empty=true;await page.locator('#reloadStatus').click();await page.waitForFunction(()=>document.getElementById('statusMessage').textContent.includes('対象社員は0人'));assert.equal(await page.locator('#statusEmployees tr').count(),0);
 fail=true;await page.locator('#reloadStatus').click();await page.waitForFunction(()=>document.getElementById('statusMessage').textContent.includes('未適用'));assert(await page.locator('#statusDetail').isHidden());
 admin=false;const before=calls.filter(c=>c.name.startsWith('admin_')).length;await page.reload();await page.waitForFunction(()=>document.getElementById('statusMessage').textContent.includes('全体管理者のみ'));
 assert.equal(calls.filter(c=>c.name.startsWith('admin_')).length,before);assert(await page.locator('#reloadStatus').isDisabled());
 assert(calls.every(c=>['is_application_admin','admin_driving_month_status','admin_driving_month_days'].includes(c.name)));assert.deepEqual(errors,[]);
 console.log('PASS admin month UI: full-admin only, pagination, read-only day reasons, own non-target access, empty roster, year rollover, SQL missing, XSS-safe text, PC/390/320.');
}finally{await browser.close();await new Promise(r=>server.close(r));}
