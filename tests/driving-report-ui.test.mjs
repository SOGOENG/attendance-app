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
 const reports=[],inspections=[],checks=[],calls=[];
 let nextId=1,failDetail=false,failLoad=false,defaultVehicle=1;
 await page.addInitScript(()=>{localStorage.setItem('portalLoginUser',JSON.stringify({id:999,name:'信用しないローカル情報'}));});
 await page.route('**/portal-auth.js',r=>r.fulfill({contentType:'text/javascript',body:'const PORTAL_SUPABASE_URL="https://mock.invalid";window.portalFetch=(url,opts)=>fetch(url,opts);window.redirectToPortalLogin=()=>{};'}));
 await page.route('https://mock.invalid/**',async route=>{
  const req=route.request(),url=new URL(req.url()),table=url.pathname.split('/').at(-1),method=req.method(),body=req.postData()?req.postDataJSON():null;
  calls.push({table,method,body,url:url.href});
  const respond=(result,status=200)=>route.fulfill({status,json:result});
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
 await page.goto(base+'/driving-report.html');await waitReady();
 const today=await page.locator('#reportDate').inputValue();
 assert.equal(today,await page.locator('#reportDate').getAttribute('max'));
 assert.equal(await page.locator('[data-result]').count(),13);
 assert.equal(await page.locator('#vehicleId').inputValue(),'1');
 assert.equal(await page.locator('#employeeName').inputValue(),'テスト社員 ／ 工事部');
 assert(await page.locator('#employeeName').getAttribute('readonly')!==null);
 await save();assert.equal(reports.length,1);assert.equal(reports[0].employee_id,7);assert.equal(reports[0].status,'draft');assert.equal(inspections.length,0);assert.equal(checks.length,0);
 await page.locator('#vehicleId').selectOption('1');await page.locator('#allGood').click();
 await page.locator('#result-tires').selectOption('defect');await page.locator('#saveDraft').click();
 await page.waitForFunction(()=>document.getElementById('drivingMessage').textContent.includes('不良の備考'));
 await page.locator('#note-tires').fill('タイヤ要確認');
 page.once('dialog',d=>d.dismiss());await page.locator('#allGood').click();assert.equal(await page.locator('#result-tires').inputValue(),'defect');
 await page.locator('#startOdometer').fill('-1');await page.locator('#saveDraft').click();
 await page.waitForFunction(()=>document.getElementById('drivingMessage').textContent.includes('出発メーターの範囲'));assert.equal(inspections.length,0);
 await page.locator('#startOdometer').fill('1234.56');await page.locator('#saveDraft').click();
 await page.waitForFunction(()=>document.getElementById('drivingMessage').textContent.includes('出発メーターの範囲'));
 await page.locator('#startOdometer').fill('');
 await page.locator('#alcoholTime').fill(today+'T07:30');await page.locator('#alcoholValue').fill('0');
 await save();assert.equal(checks.length,1);assert.equal(checks[0].phone_confirmed,null);assert.equal(checks[0].confirmed_by_name_snapshot,null);
 await page.locator('#alcoholPhone').selectOption('false');await page.locator('#alcoholConfirmer').selectOption('中尾');
 await page.locator('#returnAlcoholTime').fill(today+'T17:30');await page.locator('#returnAlcoholValue').fill('0');
 await page.locator('#returnAlcoholPhone').selectOption('true');await page.locator('#returnAlcoholConfirmer').selectOption('安藤');
 await page.locator('#outboundRoute').selectOption('other');await page.locator('#routeNote').fill('経路メモ');await page.locator('#siteId').selectOption('2');await page.locator('#startOdometer').fill('1234.5');
 await save();assert.equal(reports.length,1);assert.equal(inspections.length,13);assert.equal(checks.length,2);assert.equal(checks[0].check_type,'commute_before');
 assert.equal(checks[0].phone_confirmed,false);assert.equal(checks[1].check_type,'return_before');
 assert.equal(checks[0].checked_at,new Date(today+'T07:30:00+09:00').toISOString());
 assert.deepEqual(await page.evaluate(()=>['中尾','安藤',''].map(x=>DrivingAlcohol.excelConfirmerCode(x))),[1,2,'']);
 assert.equal(reports[0].outbound_route_type,'other');assert.equal(reports[0].start_odometer,1234.5);
 await page.locator('#siteId').selectOption('__other__');await page.locator('#saveDraft').click();
 await page.waitForFunction(()=>document.getElementById('drivingMessage').textContent.includes('行先を500文字以内'));
 await page.locator('#destinationText').fill('資材店・取引先への訪問');await save();
 assert.equal(reports[0].site_id,null);assert.equal(reports[0].destination_text,'資材店・取引先への訪問');
 await page.reload();await waitReady();assert.equal(await page.locator('#siteId').inputValue(),'__other__');
 assert.equal(await page.locator('#destinationText').inputValue(),'資材店・取引先への訪問');
 await page.locator('#siteId').selectOption('2');await save();assert.equal(reports[0].destination_text,null);
 const legacy={driving_report_id:reports[0].id,check_type:'after',checked_at:today+'T20:00:00+09:00',alcohol_value:'0.1',confirmation_method:'対面',confirmed_by_name_snapshot:'旧確認者'};
 checks.push(legacy);const oldLegacy=JSON.stringify(legacy);
 // Later-day columns are not part of any morning PATCH.
 Object.assign(reports[0],{return_route_type:'direct',end_odometer:1500,note:'帰着後メモ'});
 defaultVehicle=2;reports[0].vehicle_number_snapshot='当時の番号';reports[0].vehicle_name_snapshot='当時の車両名';
 await page.reload();await waitReady();assert.equal(await page.locator('#vehicleId').inputValue(),'1');
 assert((await page.locator('#vehicleId option:checked').textContent()).includes('当時の車両名'));
 assert.equal(await page.locator('#note-tires').inputValue(),'タイヤ要確認');assert.equal(await page.locator('#alcoholConfirmer').inputValue(),'中尾');
 assert.equal(await page.locator('#returnAlcoholConfirmer').inputValue(),'安藤');
 assert((await page.locator('#legacyAlcohol').innerText()).includes('帰着後（旧方式）'));assert.equal(JSON.stringify(legacy),oldLegacy);
 await page.screenshot({path:join(tmpdir(),'driving-report-desktop.png'),fullPage:true});
 await page.setViewportSize({width:390,height:844});
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));
 await page.screenshot({path:join(tmpdir(),'driving-report-mobile.png'),fullPage:true});
 await page.setViewportSize({width:320,height:740});
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));
 await page.evaluate(()=>document.documentElement.dataset.portalTheme='dark');
 assert.notEqual(await page.locator('.card').first().evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(255, 255, 255)');
 await page.evaluate(()=>document.documentElement.dataset.portalTheme='light');
 await page.setViewportSize({width:390,height:844});
 // Fault injection: preserve form data, explicitly report partial save, retry same report.
 await page.locator('#note-tires').fill('再保存テスト');failDetail=true;await page.locator('#saveDraft').click();await page.waitForFunction(()=>document.getElementById('drivingMessage').textContent.includes('保存が完了していません'));
 assert.equal(await page.locator('#note-tires').inputValue(),'再保存テスト');await save();assert.equal(reports.length,1);assert.equal(reports[0].return_route_type,'direct');assert.equal(reports[0].note,'帰着後メモ');
 await page.locator('[name="drivingStatus"][value="no_driving"]').check();assert(await page.locator('#inspectionList').isHidden());
 page.once('dialog',d=>d.accept());await save();assert.equal(inspections.length,0);assert.equal(checks.length,1);assert.equal(JSON.stringify(checks[0]),oldLegacy);assert.equal(reports[0].vehicle_id,null);assert.equal(reports[0].driving_status,'no_driving');
 // Submitted days are view-only; another date is editable.
 const yesterday=new Date(today+'T00:00:00Z');yesterday.setUTCDate(yesterday.getUTCDate()-1);const past=yesterday.toISOString().slice(0,10);
 const submittedId=nextId++;reports.push({id:submittedId,employee_id:7,report_date:past,status:'submitted',driving_status:'driven',destination_text:'提出済みの自由行先'});
 checks.push({driving_report_id:submittedId,check_type:'return_before',checked_at:past+'T17:00:00+09:00',alcohol_value:0,phone_confirmed:false,confirmed_by_name_snapshot:'安藤'});
 await page.locator('#reportDate').fill(past);await page.locator('#reportDate').dispatchEvent('change');await page.waitForFunction(()=>document.getElementById('drivingMessage').textContent==='この日の日報は提出済みです');assert(await page.locator('#saveDraft').isDisabled());assert(await page.locator('#vehicleId').isDisabled());
 assert.equal(await page.locator('#siteId').inputValue(),'__other__');assert.equal(await page.locator('#destinationText').inputValue(),'提出済みの自由行先');assert(await page.locator('#destinationText').isDisabled());
 assert.equal(await page.locator('#returnAlcoholConfirmer').inputValue(),'安藤');assert(await page.locator('#returnAlcoholPhone').isDisabled());
 await page.locator('#reportDate').fill(today);await page.locator('#reportDate').dispatchEvent('change');await waitReady();
 failLoad=true;await page.locator('#reloadReport').click();await page.waitForFunction(()=>document.getElementById('drivingMessage').textContent.includes('読み込めませんでした'));assert(await page.locator('#saveDraft').isDisabled());failLoad=false;await page.locator('#reloadReport').click();await waitReady();
 // Another session submits the record after load: filtered PATCH must stop before detail writes.
 reports[0].status='submitted';const beforeConflict=calls.length;await page.locator('#saveDraft').click();
 await page.waitForFunction(()=>document.getElementById('drivingMessage').textContent.includes('状態が変わりました'));
 assert.equal(calls.slice(beforeConflict).filter(c=>['driving_report_inspections','driving_alcohol_checks'].includes(c.table)&&c.method!=='GET').length,0);
 reports[0].status='draft';page.once('dialog',d=>d.accept());await page.locator('#reloadReport').click();await waitReady();
 assert.equal(await page.locator('#vehicleId').inputValue(),''); // saved no_driving NULL wins over default=2
 const newDay=new Date(today+'T00:00:00Z');newDay.setUTCDate(newDay.getUTCDate()-2);
 await page.locator('#reportDate').fill(newDay.toISOString().slice(0,10));await page.locator('#reportDate').dispatchEvent('change');await waitReady();
 assert.equal(await page.locator('#vehicleId').inputValue(),'2');
 defaultVehicle=99;newDay.setUTCDate(newDay.getUTCDate()-1);
 await page.locator('#reportDate').fill(newDay.toISOString().slice(0,10));await page.locator('#reportDate').dispatchEvent('change');await waitReady();
 assert.equal(await page.locator('#vehicleId').inputValue(),''); // inactive/missing preference is not auto-selected
 // Future dates must not reach the API or create reports.
 const future=new Date(today+'T00:00:00Z');future.setUTCDate(future.getUTCDate()+1);await page.locator('#reportDate').fill(future.toISOString().slice(0,10));await page.locator('#reportDate').dispatchEvent('change');await page.waitForFunction(()=>document.getElementById('drivingMessage').textContent.includes('今日以前'));assert(await page.locator('#saveDraft').isDisabled());
 assert(!calls.some(c=>c.table==='submit_driving_report'||c.table==='driving_refuels'));
 assert(!calls.some(c=>c.table==='sites'&&c.method!=='GET'));
 assert(!calls.some(c=>c.body && ['submitted_at','late_entry','late_entry_days','created_at','updated_at','created_by_employee_id','updated_by_employee_id','end_odometer','return_route_type'].some(k=>k in c.body)));
 assert.deepEqual(errors,[]);
 console.log('PASS morning UI: empty draft, verified employee, 13 items, defect notes, bulk confirmation, before alcohol, Tokyo time, insert/update, reload, partial failure/retry, no_driving cleanup, submitted lock, read failure, future date, later-day preservation, desktop/mobile overflow.');
 console.log('Screenshots: '+join(tmpdir(),'driving-report-desktop.png')+' / '+join(tmpdir(),'driving-report-mobile.png'));
} finally {await browser.close();await new Promise(r=>server.close(r));}
