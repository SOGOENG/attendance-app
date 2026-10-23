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
 const save=async()=>{
  const beforeSave=calls.length;
  await page.locator('#saveDraft').click();
  try{await page.waitForFunction(()=>document.getElementById('drivingMessage').textContent.includes('下書き保存しました。'),null,{timeout:10000});}
  catch(error){throw new Error(`Refuel draft save failed: ${await page.locator('#drivingMessage').textContent()} / ${JSON.stringify(calls.slice(beforeSave))} / ${errors.join(';')}`,{cause:error});}
 };
 await page.clock.install({time:new Date('2026-10-16T15:05:42Z')});
 const rows=page.locator('.driving-refuel-row');
 const add=page.locator('#addRefuel'), choice=page.locator('#refuelChoice');
 const fillFuel=async(index,liters,meter)=>{
  await rows.nth(index).locator('[data-refuel="liters"]').fill(liters);
  await rows.nth(index).locator('[data-refuel="meter"]').fill(meter);
   // Commit native number editing before section screenshots scroll the page.
   // Otherwise Chrome can restore the focused input's scroll on pointerdown.
   await rows.nth(index).locator('[data-refuel="meter"]').press('Tab');
 };
 await page.goto(base+'/driving-report.html');await waitReady();
 const today=await page.locator('#reportDate').inputValue();
 assert.equal(await choice.inputValue(),'none');assert(await page.locator('#refuelFields').isHidden());
 for(const width of [1280,390,320]) {
  await page.setViewportSize({width,height:900});
  await choice.selectOption('yes');assert.equal(await rows.count(),1);
  await fillFuel(0,'20.125','10050.1');await add.click();await fillFuel(1,'10','10100');
  for(let i=0;i<2;i++)assert.equal(await rows.nth(i).locator('[data-refuel="date"]').inputValue(),today);
  const ordered=['returnAlcoholTime','returnRoute','endOdometer','distanceKm','refuelSection','saveDraft'];
  assert(await page.locator('#refuelSection').evaluate(el=>el.matches('section.card')&&parseFloat(getComputedStyle(el).borderTopWidth)>=1&&parseFloat(getComputedStyle(el).paddingTop)>=16));
  const boxes=await Promise.all(ordered.map(id=>page.locator('#'+id).boundingBox()));
  for(let i=1;i<boxes.length;i++)assert(boxes[i].y>=boxes[i-1].y+boxes[i-1].height);
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.locator('#refuelSection').screenshot({path:join(tmpdir(),'driving-refuels-'+width+'.png')});
  await save();assert.equal(fuelRecords.length,2);
  assert.equal(fuelRecords[0].refueled_at,new Date(today+'T00:00:00+09:00').toISOString());
  const ids=fuelRecords.map(r=>r.id);await save();assert.deepEqual(fuelRecords.map(r=>r.id),ids);
  await page.reload();await waitReady();assert.equal(await rows.count(),2);assert.equal(await choice.inputValue(),'yes');
  assert.equal(await rows.nth(0).locator('[data-refuel="liters"]').inputValue(),'20.125');
  assert.equal(await rows.nth(1).locator('[data-refuel="meter"]').inputValue(),'10100');
  // Preserve original metadata and timestamp while editing just the visible values.
  fuelRecords[0].fuel_station='保存済み給油所';fuelRecords[0].refueled_at=today+'T08:12:34+09:00';
  await page.reload();await waitReady();await fillFuel(0,'22','10060');await save();
  assert.equal(fuelRecords[0].fuel_station,'保存済み給油所');assert.equal(fuelRecords[0].refueled_at,today+'T08:12:34+09:00');
  await rows.nth(1).locator('button').first().click();await save();assert.equal(fuelRecords.length,1);
  await choice.selectOption('none');await save();assert.equal(fuelRecords.length,0);
  await page.reload();await waitReady();assert.equal(await choice.inputValue(),'none');
 }
 await choice.selectOption('yes');await fillFuel(0,'0','-1');const beforeInvalid=calls.length;
 await page.locator('#saveDraft').click();assert.equal(calls.length,beforeInvalid);
 await fillFuel(0,'10','');await page.locator('#saveDraft').click();assert.equal(calls.length,beforeInvalid);
 await fillFuel(0,'10','10000');
 // Cancel date change keeps old date and inputs; accepted change discards them and sets the new date.
 const past='2026-10-15';page.once('dialog',d=>d.dismiss());await page.evaluate(date=>{const field=document.getElementById('reportDate');field.value=date;field.dispatchEvent(new Event('change'));},past);
 assert.equal(await page.locator('#reportDate').inputValue(),today);assert.equal(await rows.first().locator('[data-refuel="date"]').inputValue(),today);
 page.once('dialog',d=>d.accept());await page.evaluate(date=>{const field=document.getElementById('reportDate');field.value=date;field.dispatchEvent(new Event('change'));},past);await waitReady();
 await choice.selectOption('yes');assert.equal(await rows.first().locator('[data-refuel="date"]').inputValue(),past);await fillFuel(0,'5','9000');
 loseFuelResponse=true;await page.locator('#saveDraft').click();
 await page.waitForFunction(()=>document.getElementById('drivingMessage').textContent.includes('重複防止'));
 const afterLost=calls.length;await page.locator('#saveDraft').click();assert.equal(calls.length,afterLost);assert.equal(fuelRecords.length,1);
 assert.equal(await rows.first().locator('[data-refuel="liters"]').inputValue(),'5');
 page.once('dialog',d=>d.accept());await page.locator('#reloadReport').click();await waitReady();assert.equal(await rows.count(),1);await save();assert.equal(fuelRecords.length,1);
 // Submit with fuel through existing RPC; submitted fuel is read-only after reload.
 await page.locator('#outboundRoute').selectOption('direct');await page.locator('#returnRoute').selectOption('direct');
 await page.locator('#startOdometer').fill('8990');await page.locator('#allGood').click();
 for(const p of ['alcohol','returnAlcohol']){
  await page.locator('#'+p+'Time').fill('08:00');await page.locator('#'+p+'Value').fill('0');
  await page.locator('#'+p+'Phone').selectOption('false');await page.locator('#'+p+'Confirmer').selectOption('中尾');
 }
 await page.locator('#endOdometer').fill('9010');page.once('dialog',d=>d.accept());await page.locator('#saveDraft').click();
 await page.waitForFunction(()=>document.getElementById('drivingMessage').textContent.includes('日報を提出しました'));
 assert.equal(fuelRecords.length,1);assert(await add.isDisabled());assert(await rows.first().locator('button').first().isDisabled());
 await page.reload();await waitReady();
 await page.evaluate(date=>{const field=document.getElementById('reportDate');field.value=date;field.dispatchEvent(new Event('change'));},past);
 await page.waitForFunction(()=>document.getElementById('drivingMessage').textContent==='この日の日報は提出済みです');
 assert.equal(await rows.first().locator('[data-refuel="liters"]').inputValue(),'5');assert(await choice.isDisabled());
 assert.deepEqual(errors,[]);
 console.log('PASS refuels: default none, multiple entries, auto Tokyo dates, draft save/reload, stable IDs, edits preserve metadata, individual delete, no fuel cleanup, validation, date cancel/change, lost response duplicate guard, RPC submit and submitted lock, PC/390px/320px.');
} finally {await browser.close();await new Promise(r=>server.close(r));}
