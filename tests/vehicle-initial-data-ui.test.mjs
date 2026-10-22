// Real local Chrome + mocked API. Never uses production Supabase.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {pathToFileURL} from 'node:url';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:'playwright');
const server=createServer(async(req,res)=>{const file=new URL(req.url,'http://localhost').pathname.slice(1);if(!/^[a-z0-9.-]+$/i.test(file)){res.writeHead(404);res.end();return;}try{res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html; charset=utf-8');res.end(await readFile(new URL('../'+file,import.meta.url)));}catch{res.writeHead(404);res.end();}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_PATH});
try{
 const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 let row=null,canEdit=true,history=false,deny=false,failSave=false,saves=0;
 await page.addInitScript(()=>{localStorage.setItem('portalLoginUser','{}');});
 await page.route('**/portal-auth.js',r=>r.fulfill({contentType:'text/javascript',body:'const PORTAL_SUPABASE_URL="https://mock.invalid";window.portalFetch=(url,opts)=>fetch(url,opts);window.redirectToPortalLogin=()=>{};'}));
 await page.route('**/favicon.ico',r=>r.fulfill({status:204}));
 await page.route('https://mock.invalid/**',async route=>{
   const name=new URL(route.request().url()).pathname.split('/').at(-1),body=route.request().postDataJSON();
   const respond=data=>route.fulfill({json:data});
   if(name==='my_initial_data_vehicles')return respond([{id:1,vehicle_number:'A-001',vehicle_name:'Car'}]);
   if(name==='get_vehicle_initial_data')return deny?route.fulfill({status:403,json:{code:'42501'}}):respond({initial:row,can_edit:canEdit,has_history:history,previous_refuel:null});
   if(name==='save_vehicle_initial_data'){
     saves++;if(failSave)return route.fulfill({status:409,json:{message:'initial_revision_conflict'}});
     assert.equal(body.p_vehicle_id,'1');assert.equal(body.p_expected_revision,row?.revision??null);
     row={vehicle_id:1,baseline_date:body.p_baseline_date,end_odometer:body.p_end_odometer,refueled_date:body.p_refueled_date,
       refuel_odometer:body.p_refuel_odometer,liters:body.p_liters,fuel_station:body.p_fuel_station,payment_method:body.p_payment_method,
       created_by:1,updated_by:1,created_at:'2026-01-01T00:00:00Z',updated_at:'2026-01-02T00:00:00Z',revision:(row?.revision??0)+1};
     return respond(row);
   }
   throw Error('Unexpected API '+name);
 });
 const url='http://127.0.0.1:'+server.address().port+'/driving-initial-data.html?vehicle=1&date=2026-09-01';
 const ready=()=>page.waitForFunction(()=>!document.getElementById('saveInitial').disabled);
 await page.goto(url);await ready();
 assert.equal(await page.locator('#baselineDate').inputValue(),'2026-08-20');
 await page.locator('#initialMeter').fill('100');await page.locator('#saveInitial').click();
 await page.waitForFunction(()=>document.getElementById('initialMessage').textContent.includes('保存しました'));
 assert.equal(row.refueled_date,null);assert.equal(saves,1);
 await page.locator('#initialMeter').fill('110');await page.locator('#initialFuelDate').fill('2026-08-19');
 await page.locator('#saveInitial').click();assert.equal(saves,1);assert.equal(await page.locator('#saveInitial').isEnabled(),true);
 await page.locator('#initialFuelMeter').fill('90');await page.locator('#initialLiters').fill('10.123');
 await page.locator('#initialStation').fill('給油所');await page.locator('#saveInitial').click();
 await page.waitForFunction(()=>document.getElementById('initialMessage').textContent.includes('保存しました'));
 assert.equal(row.revision,2);assert.equal(row.liters,'10.123');
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 canEdit=false;await page.reload();await page.waitForFunction(()=>document.getElementById('initialMessage').textContent.includes('依頼'));assert(await page.locator('#saveInitial').isDisabled());
 canEdit=true;await page.reload();await ready();failSave=true;await page.locator('#initialMeter').fill('120');await page.locator('#saveInitial').click();
 await page.waitForFunction(()=>document.getElementById('initialMessage').textContent.includes('別の画面'));assert.equal(await page.locator('#initialMeter').inputValue(),'120');
 // Exercise the exact production notice module in the same real browser.
 await page.evaluate(()=>{document.body.innerHTML='<select id="vehicleId"><option value="1">Car</option></select><input id="reportDate" value="2026-09-01"><section id="initialDataNotice" hidden><p id="initialDataHint"></p><a id="initialDataLink"></a><p id="previousFuelHint"></p></section>';});
 await page.addScriptTag({url:'http://127.0.0.1:'+server.address().port+'/driving-initial-notice.js'});
 row=null;history=false;
 await page.evaluate(()=>DrivingInitialNotice.refresh('1','2026-09-01'));assert((await page.locator('#initialDataHint').textContent()).includes('登録してください'));
 row={baseline_date:'2026-08-20'};await page.evaluate(()=>DrivingInitialNotice.refresh('1','2026-09-01'));assert((await page.locator('#initialDataLink').textContent()).includes('訂正'));
 history=true;await page.evaluate(()=>DrivingInitialNotice.refresh('1','2026-09-01'));assert((await page.locator('#initialDataHint').textContent()).includes('履歴を優先'));
 await page.evaluate(()=>DrivingInitialNotice.refresh(null,'2026-09-01'));assert(await page.locator('#initialDataNotice').isHidden());
 assert.deepEqual(errors.filter(text=>text!=='Failed to load resource: the server responded with a status of 409 (Conflict)'),[]);
 assert.equal(errors.length,1);console.log('PASS Initial UI: optional fuel, validation, save, correction, read-only, conflict, mobile, notice states; no unexpected console errors (one intentionally mocked HTTP 409).');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
