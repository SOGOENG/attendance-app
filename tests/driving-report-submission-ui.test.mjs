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
 let loseFuelResponse=false;
 let nextId=1,failDetail=false,failLoad=false,defaultVehicle=1;
 let previousMeter=null,failMeter=false,meterDelay=0,denyMeter=false,failSubmit=false;
 await page.addInitScript(()=>{localStorage.setItem('portalLoginUser',JSON.stringify({id:999,name:'信用しないローカル情報'}));});
 await page.route('**/portal-auth.js',r=>r.fulfill({contentType:'text/javascript',body:'const PORTAL_SUPABASE_URL="https://mock.invalid";window.portalFetch=(url,opts)=>fetch(url,opts);window.redirectToPortalLogin=()=>{};'}));
 await page.route('https://mock.invalid/**',async route=>{
  const req=route.request(),url=new URL(req.url()),table=url.pathname.split('/').at(-1),method=req.method(),body=req.postData()?req.postDataJSON():null;
  calls.push({table,method,body,url:url.href});
  const respond=(result,status=200)=>route.fulfill({status,json:result});
  if(table==='fuel-receipts')return respond([]);
  if(table==='get_vehicle_initial_data')return respond({initial:null,has_history:false,can_edit:true,previous_refuel:null});
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
  const match=r=>[...url.searchParams].every(([k,v])=>!['id','employee_id','status','report_date','driving_report_id','check_type','inspection_item_code'].includes(k)||v.startsWith('in.')?(!v.startsWith('in.')||v.slice(4,-1).split(',').includes(String(r[k]))):String(r[k])===v.replace(/^eq\./,''));
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
 });
 const base='http://127.0.0.1:'+server.address().port;
 const waitReady=()=>page.waitForFunction(()=>!document.getElementById('reportDate').disabled&&!document.getElementById('drivingEditor').disabled);
 const save=async()=>{await page.locator('#saveDraft').click();await page.waitForFunction(()=>document.getElementById('drivingMessage').textContent.includes('下書き保存しました。'));};
 await page.clock.install({time:new Date('2026-10-16T15:05:42Z')});
 const button=page.locator('#saveDraft');
 const reset=async(width=1280)=>{
  reports.length=0;inspections.length=0;checks.length=0;failSubmit=false;failDetail=false;
  await page.setViewportSize({width,height:900});await page.reload();await waitReady();
 };
 const complete=async()=>{
  await page.locator('#outboundRoute').selectOption('direct');await page.locator('#returnRoute').selectOption('office');
  await page.locator('#startOdometer').fill('100');await page.locator('#allGood').click();
  for(const p of ['alcohol','returnAlcohol']){
   await page.locator('#'+p+'Time').fill('08:00');await page.locator('#'+p+'Value').fill('0');
   await page.locator('#'+p+'Phone').selectOption('false');await page.locator('#'+p+'Confirmer').selectOption('中尾');
  }
 };
 const waitSubmitted=()=>page.waitForFunction(()=>document.getElementById('drivingMessage').textContent.includes('日報を提出しました'));
 await page.goto(base+'/driving-report.html');await waitReady();
 for(const width of [1280,390,320]) {
  await reset(width);
  const ordered=['inspectionList','alcoholTime','outboundRoute','siteId','startOdometer','returnAlcoholTime','returnRoute','endOdometer','distanceKm'];
  const boxes=await Promise.all(ordered.map(id=>page.locator('#'+id).boundingBox()));
  for(let i=1;i<boxes.length;i++)assert(boxes[i].y>=boxes[i-1].y+boxes[i-1].height,ordered[i]+' display order');
  assert.equal(await page.locator('.driving-save button:visible').count(),1);
  assert.equal(await button.innerText(),'下書き保存');
  await page.locator('#alcoholTime').fill('07:30');await page.locator('#alcoholValue').fill('0');
  await page.locator('#alcoholPhone').selectOption('false');await page.locator('#alcoholConfirmer').selectOption('中尾');
  await save();assert.equal(reports[0].status,'draft');
  assert(!checks.some(c=>c.check_type==='return_before'));assert.equal(reports[0].return_route_type,null);
  await page.reload();await waitReady();
  assert.equal(await page.locator('#alcoholTime').inputValue(),'07:30');
  assert.equal(await page.locator('#alcoholPhone').inputValue(),'false');
  for(const suffix of ['Time','Value','Phone','Confirmer'])assert.equal(await page.locator('#returnAlcohol'+suffix).inputValue(),'');
  assert.equal(await page.locator('#returnRoute').inputValue(),'');assert.equal(await page.locator('#endOdometer').inputValue(),'');
  await page.locator('#endOdometer').fill('0');assert.equal(await button.innerText(),'提出');
  await button.click();await page.waitForFunction(()=>document.getElementById('drivingMessage').textContent.includes('行き経路を入力'));
  assert.equal(await page.locator('#endOdometer').inputValue(),'0');
  await page.locator('#endOdometer').fill('');assert.equal(await button.innerText(),'下書き保存');
  await complete();await page.locator('#endOdometer').fill('99');
  const beforeInvalid=calls.length;
  assert.equal(await page.locator('#odometerError').innerText(),'帰着メーターは出発メーター以上を入力してください');
  assert.equal(await page.locator('#endOdometer').getAttribute('aria-invalid'),'true');
  await page.locator('section').filter({has:page.locator('#endOdometer')}).screenshot({path:join(tmpdir(),'driving-meter-error-'+width+'.png')});
  await button.click();await page.waitForFunction(()=>document.getElementById('drivingMessage').textContent.includes('帰着メーターは出発'));
  assert.equal(calls.length,beforeInvalid); // No parent save, detail writes or submission RPC.
  await page.locator('#startOdometer').fill('99');assert(await page.locator('#odometerError').isHidden());
  assert.equal(await page.locator('#distanceKm').innerText(),'0 km');
  await page.locator('#startOdometer').fill('100');
  for(const value of ['-1','100.01','10000000000']) {
   await page.locator('#endOdometer').fill(value);await button.click();
   assert(await page.locator('#odometerError').isVisible());assert.equal(calls.length,beforeInvalid);
  }
  await page.locator('#endOdometer').fill('');await page.locator('#endOdometer').press('e');
  assert(await page.locator('#endOdometer').evaluate(el=>el.validity.badInput));
  await button.click();assert(await page.locator('#odometerError').isVisible());assert.equal(calls.length,beforeInvalid);
  await page.locator('#endOdometer').fill('100');await page.locator('#startOdometer').fill('');await button.click();
  assert((await page.locator('#odometerError').innerText()).includes('出発メーター'));assert.equal(calls.length,beforeInvalid);
  for(const value of ['-1','100.01','10000000000']) {
   await page.locator('#startOdometer').fill(value);await button.click();assert.equal(calls.length,beforeInvalid);
   assert(await page.locator('#odometerError').isVisible());
  }
  await page.locator('#startOdometer').fill('');await page.locator('#startOdometer').press('e');await button.click();
  assert.equal(calls.length,beforeInvalid);assert(await page.locator('#odometerError').isVisible());
  await page.locator('#startOdometer').fill('100');assert(await page.locator('#odometerError').isHidden());
  await page.locator('#endOdometer').fill('100');
  assert(await page.locator('#odometerError').isHidden());
  await page.locator('#result-tires').selectOption('');await button.click();
  await page.waitForFunction(()=>document.getElementById('drivingMessage').textContent.includes('13項目すべて'));
  await page.locator('#result-tires').selectOption('ok');await page.locator('#returnAlcoholPhone').selectOption('');await button.click();
  await page.waitForFunction(()=>document.getElementById('drivingMessage').textContent.includes('両アルコール'));
  await page.locator('#returnAlcoholPhone').selectOption('false');
  const beforeCancel=calls.length;page.once('dialog',d=>d.dismiss());await button.click();
  assert.equal(calls.length,beforeCancel);assert.equal(await page.locator('#endOdometer').inputValue(),'100');
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  const bounds=await button.boundingBox();assert(bounds.width>100&&bounds.height>=44);
  await page.locator('.driving-save').screenshot({path:join(tmpdir(),'driving-submit-'+width+'.png')});
  const beforeSubmit=calls.filter(c=>c.table==='submit_driving_report').length;
  page.once('dialog',d=>d.accept());await button.click();
  await page.evaluate(()=>{const f=document.getElementById('drivingForm');f.dispatchEvent(new Event('submit',{cancelable:true}));f.dispatchEvent(new Event('submit',{cancelable:true}));});
  await waitSubmitted();
  assert.equal(calls.filter(c=>c.table==='submit_driving_report').length,beforeSubmit+1);
  assert.equal(reports[0].end_odometer,100);assert.equal(reports[0].return_route_type,'office');
  assert(await button.isDisabled());assert.equal(await button.innerText(),'提出済み');assert(await page.locator('#endOdometer').isDisabled());
  await page.reload();await page.waitForFunction(()=>document.getElementById('drivingMessage').textContent==='この日の日報は提出済みです');
  assert(await button.isDisabled());assert.equal(await page.locator('#endOdometer').inputValue(),'100');
 }
 await reset();await complete();await page.locator('#startOdometer').fill('0');await page.locator('#endOdometer').fill('0');
 assert.equal(await page.locator('#distanceKm').innerText(),'0 km');
 page.once('dialog',d=>d.accept());await button.click();await waitSubmitted();assert.equal(reports[0].end_odometer,0);
 // Failed detail save must not call the submission RPC; retry retains entered values.
 await reset();await complete();await page.locator('#endOdometer').fill('110');failDetail=true;
 const beforeDetail=calls.filter(c=>c.table==='submit_driving_report').length;
 page.once('dialog',d=>d.accept());await button.click();
 await page.waitForFunction(()=>document.getElementById('drivingMessage').textContent.includes('保存が完了していません'));
 assert.equal(calls.filter(c=>c.table==='submit_driving_report').length,beforeDetail);
 assert.equal(await page.locator('#endOdometer').inputValue(),'110');assert(await button.isEnabled());
 failSubmit=true;page.once('dialog',d=>d.accept());await button.click();
 await page.waitForFunction(()=>document.getElementById('drivingMessage').textContent.includes('提出検証エラー'));
 assert.equal(reports[0].status,'draft');assert.equal(await page.locator('#startOdometer').inputValue(),'100');
 assert.equal(await page.locator('#endOdometer').inputValue(),'110');assert(await button.isEnabled());
 failSubmit=false;page.once('dialog',d=>d.accept());await button.click();await waitSubmitted();
 // No-driving uses the same single button and requires neither meter nor driving details.
 await reset(390);await page.locator('[name="drivingStatus"][value="no_driving"]').check();
 assert.equal(await button.innerText(),'提出');page.once('dialog',d=>d.accept());await button.click();await waitSubmitted();
 assert.equal(reports[0].start_odometer,null);assert.equal(reports[0].end_odometer,null);
 assert.equal(reports[0].vehicle_id,null);assert.equal(reports[0].return_route_type,null);
 assert.equal(inspections.length,0);assert.equal(checks.length,0);
 assert.deepEqual(errors,[]);
 console.log('PASS single save/submit button: blank/filled/deleted end meter, required fields, lower end rejection, cancel without writes, RPC submission, double-submit guard, submitted lock/reload, detail failure, RPC rejection and retry, no-driving without meters, PC/390px/320px.');
} finally {await browser.close();await new Promise(r=>server.close(r));}
