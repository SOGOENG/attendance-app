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
 const page=await browser.newPage({viewport:{width:1280,height:900},timezoneId:'America/Los_Angeles'});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const reports=[],inspections=[],checks=[],calls=[],fuelRecords=[];
 let loseFuelResponse=false,conflictSave=false,failMonth=false,missingRpc=false,malformed=false,validationRace=false,checkIssues=[],api='http://127.0.0.1:54321';
 const submittedMonths=new Set();
 let nextId=1,failDetail=false,failLoad=false,defaultVehicle=1;
 let previousMeter=null,failMeter=false,meterDelay=0,denyMeter=false,failSubmit=false;
 await page.addInitScript(()=>{localStorage.setItem('portalLoginUser',JSON.stringify({id:999,name:'信用しないローカル情報'}));});
 await page.route('**/portal-auth.js',r=>r.fulfill({contentType:'text/javascript',body:`const PORTAL_SUPABASE_URL=${JSON.stringify(api)};window.portalFetch=(url,opts)=>fetch(url,opts);window.redirectToPortalLogin=()=>{};`}));
 const mockApi=async route=>{
  const req=route.request(),url=new URL(req.url()),table=url.pathname.split('/').at(-1),method=req.method(),body=req.postData()?req.postDataJSON():null;
  calls.push({table,method,body,url:url.href});
  const respond=(result,status=200)=>route.fulfill({status,json:result});
  if(['holidays','attendance','applications'].includes(table))return respond(table==='holidays'?[{date:'2026-10-18',day_type:'休日'},{date:'2026-10-19',day_type:'出勤'}]:[]);
  if(table==='check_driving_report_month'){
   if(missingRpc)return respond({code:'PGRST202',message:'RPC missing'},404);
   const month=body.p_closing_month.slice(0,7),start=new Date(month+'-01T00:00:00Z');start.setUTCMonth(start.getUTCMonth()-1);start.setUTCDate(21);
   const end=month+'-20',days=[];
   for(let d=new Date(start);d.toISOString().slice(0,10)<=end;d.setUTCDate(d.getUTCDate()+1))days.push({date:d.toISOString().slice(0,10),required:true,status:'draft',issue:null});
   return respond({closing_month:body.p_closing_month,period_start:start.toISOString().slice(0,10),period_end:end,eligible:month<'2026-11',valid:!checkIssues.length,already_submitted:submittedMonths.has(month),days,errors:checkIssues});
  }
  if(table==='submit_driving_report_month'){
   if(validationRace){checkIssues=[{date:'2026-10-19',code:'report_missing'}];return respond({code:'P0001',message:'driving_month_validation_failed'},400);}
   if(failMonth)return respond({code:'55P03',message:'driving_month_busy_retry'},409);
   if(malformed)return respond({});
   const month=body.p_closing_month.slice(0,7);submittedMonths.add(month);
   reports.filter(r=>r.report_date>='2026-09-21'&&r.report_date<='2026-10-20').forEach(r=>r.status='submitted');
   return respond({id:9,employee_id:7,closing_month:body.p_closing_month,period_start:'2026-09-21',period_end:'2026-10-20',submitted_at:'2026-10-21T00:00:00+09:00'});
  }
  if(table==='driving_reports'&&method!=='GET'&&conflictSave)return respond({code:'55P03',message:'driving_month_busy_retry'},409);
  if(table==='fuel-receipts')return respond([]);
  if(table==='previous_vehicle_end_odometer') {
   const value=previousMeter,fail=failMeter,delay=meterDelay;
   if(denyMeter)return respond({code:'42501',message:'vehicle_odometer_access_denied'},403);
   if(delay)await new Promise(r=>setTimeout(r,delay));
   return fail?respond({message:'取得失敗'},500):respond(value);
  }
  if(table==='submit_driving_report') {
   await new Promise(r=>setTimeout(r,150));
   if(failSubmit)return respond({message:'提出検証エラー'},400);
   const report=reports.find(r=>r.id===body.p_driving_report_id && r.employee_id===7 && r.status==='draft');
   if(!report)return respond({message:'draft_report_required'},400);
   report.status='submitted';return respond(report);
  }
  if(table==='current_employee_id')return respond(7);
  if(table==='driving_report_inspection_items')return respond(items);
  if(table==='employees')return respond([{id:7,name:'テスト社員',department:'工事部',default_vehicle_id:defaultVehicle}]);
  if(table==='vehicles')return respond([{id:1,vehicle_number:'A-001',vehicle_name:'社用車'},{id:2,vehicle_number:'A-002',vehicle_name:'新車'}]);
  if(table==='sites')return respond([{id:2,display_name:'テスト現場'}]);
  const eq=key=>url.searchParams.get(key)?.replace(/^eq\./,'');
  const match=r=>[...url.searchParams].every(([k,v])=>{
   if(!['id','employee_id','status','report_date','driving_report_id','check_type','inspection_item_code'].includes(k))return true;
   if(v.startsWith('in.'))return v.slice(4,-1).split(',').includes(String(r[k]));
   if(v.startsWith('gte.'))return String(r[k])>=v.slice(4);
   if(v.startsWith('lt.'))return String(r[k])<v.slice(3);
   return String(r[k])===v.replace(/^eq\./,'');
  });
  if(table==='driving_reports'){
   if(method==='GET'){if(failLoad)return respond({message:'読込エラー'},500);return respond(reports.filter(match));}
   if(method==='POST'){const r={id:nextId++,...body};reports.push(r);return respond([r]);}
   if(method==='PATCH'){const rows=reports.filter(match);rows.forEach(r=>Object.assign(r,body));return respond(rows);}
  }
  if(table==='driving_refuels') {
   if(method==='GET')return respond(fuelRecords.filter(match));
   if(method==='POST'){
    const saved={id:nextId++,...body};fuelRecords.push(saved);
    if(loseFuelResponse){loseFuelResponse=false;return respond({message:'給油応答喪失'},500);}
    return respond([saved]);
   }
   if(method==='PATCH'){const rows=fuelRecords.filter(match);rows.forEach(r=>Object.assign(r,body));return respond(rows);}
   if(method==='DELETE'){const deleted=fuelRecords.filter(match);for(const row of deleted)fuelRecords.splice(fuelRecords.indexOf(row),1);return respond(deleted);}
  }
  if(['driving_report_inspections','driving_alcohol_checks'].includes(table)){
   const rows=table==='driving_report_inspections'?inspections:checks;
   if(method==='GET')return respond(rows.filter(match));
   if(failDetail && method==='POST'){failDetail=false;return respond({message:'テスト保存失敗'},500);}
   if(method==='POST'){for(const row of Array.isArray(body)?body:[body]){const existing=rows.find(r=>String(r.driving_report_id)===String(row.driving_report_id)&&(r.inspection_item_code||r.check_type)===(row.inspection_item_code||row.check_type));if(existing)Object.assign(existing,row);else rows.push(row);}return respond(Array.isArray(body)?body:[body]);}
   if(method==='DELETE'){const deleted=rows.filter(match);for(const row of deleted)rows.splice(rows.indexOf(row),1);return respond(deleted);}
  }
  throw new Error('Unexpected API '+method+' '+url);
 };
 await page.route('http://127.0.0.1:54321/**',mockApi);
 await page.route('https://fgmvmbjnoyagnpygcbky.supabase.co/**',mockApi);
 const base='http://127.0.0.1:'+server.address().port;
 const waitReady=()=>page.waitForFunction(()=>!document.getElementById('reportDate').disabled&&!document.getElementById('drivingEditor').disabled);
 await page.clock.install({time:new Date('2026-10-21T09:00:00+09:00')});
 const daily=base+'/driving-report.html?date=2026-10-19&mode=monthly';
 page.on('dialog',dialog=>dialog.accept());
 await page.goto(daily);await waitReady();
 assert.equal(await page.locator('#saveDraft').innerText(),'一時保存（朝）');
 assert.equal(await page.locator('#saveReturn').innerText(),'保存（帰り）');
 await page.locator('#saveDraft').click();await page.waitForFunction(()=>document.getElementById('drivingMessage').textContent.includes('一時保存（朝）しました'));
 assert.equal(reports[0].status,'draft');assert(await page.locator('#endOdometer').isEnabled());
 await page.locator('#saveReturn').click();await page.waitForFunction(()=>document.getElementById('drivingMessage').textContent.includes('未完了'));
 assert.equal(reports[0].status,'draft');
 await page.locator('[name="drivingStatus"][value="no_driving"]').check();
 await page.locator('#saveReturn').click();await page.waitForFunction(()=>document.getElementById('drivingMessage').textContent.includes('保存（帰り）しました')&&!document.getElementById('drivingMessage').textContent.includes('未完了'));
 assert.equal(reports[0].driving_status,'no_driving');assert.equal(reports[0].status,'draft');
 // Complete return save retains all driving details and multiple refuels as draft.
 await page.locator('[name="drivingStatus"][value="driven"]').check();
 await page.locator('#allGood').click();await page.locator('#outboundRoute').selectOption('office');await page.locator('#returnRoute').selectOption('direct');
 await page.locator('#startOdometer').fill('100');await page.locator('#endOdometer').fill('200');
 for(const prefix of ['alcohol','returnAlcohol']){
  await page.locator('#'+prefix+'Time').fill('08:00');await page.locator('#'+prefix+'Value').fill('0');
  await page.locator('#'+prefix+'Phone').selectOption('false');await page.locator('#'+prefix+'Confirmer').selectOption('中尾');
 }
 await page.locator('#refuelChoice').selectOption('yes');
 await page.locator('[data-refuel="liters"]').first().fill('10');await page.locator('[data-refuel="meter"]').first().fill('150');
 await page.locator('#addRefuel').click();await page.locator('[data-refuel="liters"]').nth(1).fill('20');await page.locator('[data-refuel="meter"]').nth(1).fill('180');
 await page.locator('#saveReturn').click();await page.waitForFunction(()=>document.getElementById('drivingMessage').textContent.includes('保存（帰り）しました')&&!document.getElementById('drivingEditor').disabled);
 assert.equal(reports[0].status,'draft');assert.equal(fuelRecords.length,2);assert.equal(inspections.length,13);assert.equal(checks.length,2);
 assert.equal(await page.locator('#distanceKm').innerText(),'100 km');
 for(const width of [1280,390,320]){
  await page.setViewportSize({width,height:900});
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  assert(await page.locator('#saveDraft').isEnabled());assert(await page.locator('#saveReturn').isEnabled());
  const a=await page.locator('#saveDraft').boundingBox(),b=await page.locator('#saveReturn').boundingBox();
  assert(a.x+a.width<=width&&b.x+b.width<=width);
  await page.screenshot({path:join(tmpdir(),`driving-month-daily-${width}.png`),fullPage:true});
 }
 conflictSave=true;
 await page.locator('#saveDraft').click();await page.waitForFunction(()=>document.getElementById('drivingMessage').textContent.includes('ほかの操作と重なりました。再読み込みしてから保存してください'));
 assert(await page.locator('#saveDraft').isDisabled());conflictSave=false;
 await page.locator('#reloadReport').click();await waitReady();
 failDetail=true;await page.locator('[name="drivingStatus"][value="driven"]').check();await page.locator('#allGood').click();
 await page.locator('#saveDraft').click();await page.waitForFunction(()=>document.getElementById('drivingMessage').textContent.includes('保存が完了していません'));
 assert(!await page.locator('#drivingMessage').evaluate(n=>n.textContent.includes('しました。月別')));
 assert(!calls.some(c=>c.table==='submit_driving_report'));
 await page.goto(base+'/driving-report-month.html?mode=monthly');await page.waitForSelector('.monthly-day');
 await page.locator('#closingMonth').selectOption('2026-10');await page.waitForFunction(()=>document.getElementById('monthlyPeriod').textContent==='期間：9/21〜10/20'&&!document.getElementById('reloadMonth').disabled);
 assert.equal(await page.locator('[data-date="2026-10-18"] a').innerText(),'休日出勤');
 assert.equal(await page.locator('[data-date="2026-10-18"] strong').evaluate(n=>getComputedStyle(n).color),'rgb(216, 27, 96)');
 assert.equal(await page.locator('.monthly-calendar:visible,.monthly-work:visible').count(),0);
 for(const width of [1280,390,320]){
  await page.setViewportSize({width,height:900});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.screenshot({path:join(tmpdir(),`driving-month-submit-${width}.png`),fullPage:true});
 }
 assert.equal(await page.locator('#submitMonth').innerText(),'10月分をまとめて提出');
 assert((await page.locator('#monthlyCounts').innerText()).includes('下書き 1件'));
 assert.equal(await page.locator('[data-date="2026-10-19"] a').innerText(),'続きから入力');
 // Dedicated class and all states: computed styles hide visited history, so
 // compare rendered link screenshots before/after an actual same-origin visit too.
 const holidayLink=page.locator('[data-date="2026-10-18"] a');
 const normalLink=page.locator('[data-date="2026-10-20"] a');
 assert(await holidayLink.evaluate(n=>n.classList.contains('monthly-holiday-work')));
 const styles=locator=>locator.evaluate(n=>{const s=getComputedStyle(n);return {color:s.color,border:s.borderTopColor,background:s.backgroundColor};});
 assert.deepEqual(await styles(holidayLink),{color:'rgb(216, 27, 96)',border:'rgb(216, 27, 96)',background:'rgb(255, 255, 255)'});
 assert.notEqual((await styles(normalLink)).color,'rgb(216, 27, 96)');
 await holidayLink.focus();assert.equal((await styles(holidayLink)).color,'rgb(216, 27, 96)');
 await holidayLink.evaluate(n=>n.blur());await page.mouse.move(0,0);
 const beforeVisited=await holidayLink.screenshot();
 await holidayLink.click();await waitReady();await page.goBack();
 await page.waitForSelector('.monthly-day');await page.locator('#closingMonth').selectOption('2026-10');
 await page.waitForFunction(()=>!document.getElementById('reloadMonth').disabled);
 await page.mouse.move(0,0);await holidayLink.evaluate(n=>n.blur());
 assert.deepEqual(await holidayLink.screenshot(),beforeVisited,'visited link must render identically');
 assert.equal((await styles(holidayLink)).color,'rgb(216, 27, 96)');
 checkIssues=[{date:'2026-10-19',code:'report_missing'},{date:'2026-10-19',code:'report_missing'},{date:'2026-10-20',code:'work_unconfirmed'}];
 await page.locator('#reloadMonth').click();await page.waitForFunction(()=>!document.getElementById('reloadMonth').disabled);
 assert((await page.locator('#monthSubmitSummary').innerText()).includes('未入力・要確認：2日'));
 assert((await page.locator('#monthSubmitSummary').innerText()).includes('未入力 1日／未完了・要確認 1日'));
 assert.equal(await page.locator('#monthSubmitDetails').evaluate(n=>n.open),false);
 assert.equal(await page.locator('#monthSubmitIssues:visible').count(),0);
 for(const width of [1280,390,320]){await page.setViewportSize({width,height:900});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:join(tmpdir(),`driving-month-summary-${width}.png`),fullPage:true});}

 await page.locator('#submitMonth').click();await page.waitForFunction(()=>document.getElementById('monthSubmitIssues').textContent.includes('日報がありません')&&document.getElementById('monthSubmitDetails').open&&!document.getElementById('submitMonth').disabled);
 assert(!calls.some(c=>c.table==='submit_driving_report_month'));
 assert.equal(await page.locator('#monthSubmitDetails').evaluate(n=>n.open),true);
 checkIssues=[];validationRace=true;
 const raceResponse=page.waitForResponse(r=>r.url().endsWith('/submit_driving_report_month')&&r.status()===400);
 await page.locator('#submitMonth').click();await raceResponse;await page.waitForFunction(()=>document.getElementById('monthSubmitIssues').textContent.includes('2026-10-19：日報がありません')&&!document.getElementById('submitMonth').disabled);
 assert(!submittedMonths.size);validationRace=false;
 checkIssues=[];failMonth=true;
 await page.locator('#submitMonth').click();await page.waitForFunction(()=>document.getElementById('monthSubmitMessage').textContent.includes('ほかの操作と重なりました'));
 assert(await page.locator('#submitMonth').isDisabled());failMonth=false;
 await page.locator('#reloadMonth').click();await page.waitForFunction(()=>!document.getElementById('submitMonth').disabled);
 malformed=true;await page.locator('#submitMonth').click();await page.waitForFunction(()=>document.getElementById('monthSubmitMessage').textContent.includes('確認できません'));
 assert(!submittedMonths.size);malformed=false;
 await page.locator('#reloadMonth').click();await page.waitForFunction(()=>!document.getElementById('submitMonth').disabled);
 const submitCount=calls.filter(c=>c.table==='submit_driving_report_month').length;
 await page.locator('#submitMonth').evaluate(button=>{button.click();button.click();});await page.waitForFunction(()=>document.getElementById('submitMonth').textContent==='月別提出済み');
 assert.equal(calls.filter(c=>c.table==='submit_driving_report_month').length,submitCount+1);
 assert(await page.locator('#submitMonth').isDisabled());
 assert.equal(await page.locator('[data-date="2026-10-18"] a').count(),0);
 await page.goto(daily);await page.waitForFunction(()=>document.getElementById('drivingMessage').textContent.includes('提出済み'));
 assert(await page.locator('#saveDraft').isDisabled());assert(await page.locator('#saveReturn').isDisabled());
 await page.goto(base+'/driving-report.html?date=2026-10-18&mode=monthly');await page.waitForFunction(()=>document.getElementById('drivingMessage').textContent.includes('提出済み'));
 assert(await page.locator('#saveDraft').isDisabled());
 missingRpc=true;await page.goto(daily);await page.waitForFunction(()=>document.getElementById('drivingMessage').textContent.includes('読み込めませんでした'));
 assert(await page.locator('#saveDraft').isDisabled());
 await page.goto(base+'/driving-report-month.html?mode=monthly');await page.waitForFunction(()=>document.getElementById('monthSubmitMessage').textContent.includes('確認できません'));
 assert(await page.locator('#submitMonth').isDisabled());missingRpc=false;
 // The 20th cannot submit. No submit RPC is issued when a click is forged.
 submittedMonths.clear();await page.clock.setFixedTime(new Date('2026-10-20T23:59:00+09:00'));
 await page.goto(base+'/driving-report-month.html?mode=monthly');await page.waitForSelector('.monthly-day');
 assert(await page.locator('#submitMonth').isDisabled());
 // Company API is fully intercepted: no actual Supabase request is allowed.
 api='https://fgmvmbjnoyagnpygcbky.supabase.co';reports.forEach(row=>row.status='draft');
 await page.goto(base+'/driving-report.html?date=2026-10-19');await waitReady();
 assert.equal(await page.locator('#saveDraft').innerText(),'一時保存（朝）');
 assert.equal(await page.locator('#saveReturn').innerText(),'保存（帰り）');
 assert.equal(await page.locator('#drivingModeLabel').innerText(),'月別提出方式');
 await page.locator('#saveDraft').click();await page.waitForFunction(()=>document.getElementById('drivingMessage').textContent.includes('一時保存（朝）しました'));
 assert(reports.every(row=>row.status==='draft'));
 await page.goto(base+'/driving-report-month.html');await page.waitForSelector('.monthly-day');
 assert.equal(await page.locator('#submitMonth').innerText(),'10月分をまとめて提出');
 assert(await page.locator('#submitMonth').isDisabled());
 const beforeBoundary=calls.filter(c=>c.table==='submit_driving_report_month').length;
 await page.locator('#submitMonth').evaluate(n=>{n.disabled=false;n.click();});
 assert.equal(calls.filter(c=>c.table==='submit_driving_report_month').length,beforeBoundary);
 await page.clock.setFixedTime(new Date('2026-10-21T00:00:00+09:00'));
 await page.goto(base+'/driving-report-month.html');await page.waitForSelector('.monthly-day');
 await page.locator('#closingMonth').selectOption('2026-09');await page.waitForFunction(()=>document.getElementById('monthSubmitMessage').textContent.includes('2026年10月分'));assert(await page.locator('#submitMonth').isDisabled());
 await page.locator('#closingMonth').selectOption('2026-10');await page.waitForFunction(()=>!document.getElementById('submitMonth').disabled);
 checkIssues=[{date:'2026-10-19',code:'receipt_upload_pending'},{date:'2026-10-20',code:'work_leave_conflict'}];
 await page.locator('#submitMonth').click();await page.waitForFunction(()=>document.getElementById('monthSubmitIssues').textContent.includes('領収書の処理が完了していません'));
 assert((await page.locator('#monthSubmitIssues').innerText()).includes('2026-10-20：勤務と休暇の情報が一致しません'));
 assert.equal(calls.filter(c=>c.table==='submit_driving_report_month').length,beforeBoundary);
 checkIssues=[];
 for(const width of [1280,390,320]){await page.setViewportSize({width,height:900});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));}
 await page.locator('#submitMonth').click();await page.waitForFunction(()=>document.getElementById('submitMonth').textContent==='月別提出済み');
 assert.equal(calls.filter(c=>c.table==='submit_driving_report_month').length,beforeBoundary+1);
 await page.goto(base+'/driving-report.html?date=2026-10-18');await page.waitForFunction(()=>document.getElementById('drivingMessage').textContent.includes('提出済み'));
 assert(await page.locator('#saveDraft').isDisabled());assert(await page.locator('#saveReturn').isDisabled());
 assert(!calls.some(c=>c.table==='submit_driving_report'));
 // Another project never gets the newly enabled monthly API calls.
 api='https://other-project.invalid';const beforeBlocked=calls.length;
 await page.route('https://other-project.invalid/**',r=>{throw Error('Other project must not receive a request');});
 await page.goto(base+'/driving-report.html?mode=monthly');await page.waitForFunction(()=>document.getElementById('drivingMessage').textContent.includes('準備中'));
 assert(await page.locator('#saveDraft').isDisabled());assert.equal(calls.length,beforeBlocked);
 assert.deepEqual(errors,[]);
 console.log('PASS monthly submission UI: company default + explicit local mock, morning/return draft + missing guidance, no-driving draft, no daily submit RPC, conflict/failure, holiday pink/entry, hidden long rows, preflight issues, submit failure/malformed/missing RPC, successful month locks including absent dates, 20/21, other-project guard, company API intercepted, PC/390/320. Mock APIs only.');
} finally {await browser.close();await new Promise(r=>server.close(r));}
