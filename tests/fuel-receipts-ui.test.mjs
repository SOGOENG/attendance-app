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
 let loseFuelResponse=false,failReceipt=false,previewURL='';
 const receiptItems=[];
 let nextId=1,failDetail=false,failLoad=false,defaultVehicle=1;
 let previousMeter=null,failMeter=false,meterDelay=0,denyMeter=false,failSubmit=false;
 await page.addInitScript(()=>{window.receiptCameraCalls=0;if(navigator.mediaDevices)navigator.mediaDevices.getUserMedia=()=>{window.receiptCameraCalls++;return Promise.reject(Error('Custom camera must not be used'));};localStorage.setItem('portalLoginUser',JSON.stringify({id:999,name:'信用しないローカル情報'}));});
 await page.route('**/portal-auth.js',r=>r.fulfill({contentType:'text/javascript',body:'const PORTAL_SUPABASE_URL="https://mock.invalid";window.portalFetch=(url,opts)=>fetch(url,opts);window.redirectToPortalLogin=()=>{};'}));
 await page.route('https://mock.invalid/**',async route=>{
  const req=route.request(),url=new URL(req.url()),table=url.pathname.split('/').at(-1),method=req.method(),body=req.headers()['content-type']?.includes('application/json')?req.postDataJSON():null;
  calls.push({table,method,body,url:url.href});
  const respond=(result,status=200)=>route.fulfill({status,json:result});
  if(table==='fuel-receipts'){
   if(req.headers()['content-type']?.includes('multipart/form-data')){
    const form=await new Request(req.url(),{method:'POST',headers:{'Content-Type':req.headers()['content-type']},body:req.postDataBuffer()}).formData();
    const id=form.get('id'),refuel_id=Number(form.get('refuel_id')),file=form.get('file');
    if(failReceipt){failReceipt=false;return respond({error:'添付アップロード失敗'},500);}
    const existing=receiptItems.find(x=>x.id===id);if(existing)return respond(existing);
    receiptItems.filter(x=>x.refuel_id===refuel_id).forEach(x=>x.state='removed');
    const item={id,refuel_id,mime:file.type,state:'active',bytes:file.size,preview:previewURL};receiptItems.push(item);return respond(item);
   }
   if(body.action==='get')return respond(receiptItems.filter(x=>x.refuel_id===body.data.refuel_id&&x.state!=='removed'));
   if(body.action==='view')return respond({url:previewURL,mime:receiptItems.find(x=>x.id===body.data.id)?.mime||'image/jpeg'});
   if(body.action==='remove'){const c=receiptItems.find(x=>x.id===body.data.id);if(c)c.state='removed';return respond(c);}
   return respond({});
  }
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
   if(method==='DELETE'){const deleted=fuelRecords.filter(match);if(deleted.some(row=>receiptItems.some(c=>c.refuel_id===row.id&&['active','pending','deleting'].includes(c.state))))return respond({message:'remove_receipt_before_refuel'},400);for(const row of deleted)fuelRecords.splice(fuelRecords.indexOf(row),1);return respond(deleted);}
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
 const rows=page.locator('.driving-refuel-row');
 const fill=async(index,meter)=>{await rows.nth(index).locator('[data-refuel="liters"]').fill('10');await rows.nth(index).locator('[data-refuel="meter"]').fill(meter);};
 await page.goto(base+'/driving-report.html');await waitReady();
 previewURL=await page.evaluate(()=>{const canvas=document.createElement('canvas');canvas.width=900;canvas.height=4000;const c=canvas.getContext('2d');c.fillStyle='white';c.fillRect(0,0,900,4000);c.fillStyle='black';c.font='30px sans-serif';for(let y=40;y<4000;y+=80)c.fillText('2026-10-17 Receipt Fuel 10 L / 1500 yen',20,y);return canvas.toDataURL('image/png');});
 const png=Buffer.from(previewURL.split(',')[1],'base64');
 const jpeg=Buffer.from((await page.evaluate(async url=>{const img=new Image();img.src=url;await img.decode();const c=document.createElement('canvas');c.width=img.naturalWidth;c.height=img.naturalHeight;c.getContext('2d').drawImage(img,0,0);return c.toDataURL('image/jpeg',.95);},previewURL)).split(',')[1],'base64');
 for(const width of [1280,390,320]){
  await page.setViewportSize({width,height:900});await page.locator('#refuelChoice').selectOption('yes');await fill(0,'100');
  const row=rows.first();assert.equal(await row.locator('[data-receipt="camera-input"]').getAttribute('capture'),'environment');
  assert.equal(await row.locator('[data-receipt="file-input"]').getAttribute('capture'),null);
  const photo=width===390?{name:'tall.png',mimeType:'image/png',buffer:png}:{name:'tall.jpg',mimeType:'image/jpeg',buffer:jpeg};
  const [camera]=await Promise.all([page.waitForEvent('filechooser'),row.locator('[data-receipt="camera"]').click()]);
  assert.equal(await camera.element().getAttribute('capture'),'environment');await camera.setFiles(photo);
  await page.waitForFunction(()=>document.querySelector('[data-receipt="notice"]').textContent.includes('保存待ち'));
  assert.equal(await row.locator('[data-receipt="camera"]').innerText(),'標準カメラで再撮影');
  const beforeRetake=await row.locator('.receipt-preview img').getAttribute('src');
  const [retake]=await Promise.all([page.waitForEvent('filechooser'),row.locator('[data-receipt="camera"]').click()]);await retake.setFiles(photo);
  await page.waitForFunction(old=>document.querySelector('.receipt-preview img')?.src!==old,beforeRetake);
  const beforeLibrary=await row.locator('.receipt-preview img').getAttribute('src');
  const [cancel]=await Promise.all([page.waitForEvent('filechooser'),row.locator('[data-receipt="choose"]').click()]);assert.equal(await cancel.element().getAttribute('capture'),null);await cancel.setFiles([]);
  assert.equal(await row.locator('.receipt-preview img').getAttribute('src'),beforeLibrary);
  const [library]=await Promise.all([page.waitForEvent('filechooser'),row.locator('[data-receipt="choose"]').click()]);await library.setFiles(photo);
  await page.waitForFunction(old=>document.querySelector('.receipt-preview img')?.src!==old,beforeLibrary);
  const touch=await row.locator('.receipt-preview a').boundingBox();assert(touch.width>=44&&touch.height>=44);
  const dimensions=await row.locator('.receipt-preview img').evaluate(img=>({w:img.naturalWidth,h:img.naturalHeight}));assert(dimensions.h>dimensions.w*4); // Full tall receipt, no crop.
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await row.locator('.receipt-attachment').screenshot({path:join(tmpdir(),'fuel-receipt-upload-'+width+'.png')});
  failReceipt=true;await page.locator('#saveDraft').click();await page.waitForFunction(()=>document.getElementById('drivingMessage').textContent.includes('添付アップロード失敗'));
  assert.equal(await row.locator('[data-refuel="liters"]').inputValue(),'10');assert(await row.locator('.receipt-preview img').isVisible());
  await save();assert.equal(receiptItems.filter(x=>x.state==='active').length,1);
  await page.reload();await waitReady();await page.waitForSelector('.receipt-preview img');assert.equal(await rows.count(),1);
  const active=receiptItems.find(x=>x.state==='active');assert.equal(active.refuel_id,fuelRecords[0].id);
  // HEIC fallback is explicit on Chromium, with no upload or previous-attachment loss.
  await rows.first().locator('[data-receipt="file-input"]').setInputFiles({name:'unsupported.heic',mimeType:'image/heic',buffer:Buffer.from('not-a-decodable-heic')});
  await page.waitForFunction(()=>document.querySelector('[data-receipt="notice"]').textContent.includes('HEIC'));
  await rows.first().locator('[data-receipt="file-input"]').setInputFiles({name:'receipt.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.7\nfixture')});
  await page.waitForFunction(()=>document.querySelector('[data-receipt="notice"]').textContent.includes('保存待ち'));await save();
  assert.equal(receiptItems.find(x=>x.state==='active').mime,'application/pdf');
  await rows.first().locator('[data-receipt="remove"]').click();await save();assert.equal(receiptItems.filter(x=>x.state==='active').length,0);
  await rows.first().locator('button').first().click();await save();assert.equal(fuelRecords.length,0);
 }
 // Two separate refuels retain distinct attachments across reload and vehicle changes.
 await page.locator('#refuelChoice').selectOption('yes');await fill(0,'100');await page.locator('#addRefuel').click();await fill(1,'110');
 for(let i=0;i<2;i++)await rows.nth(i).locator('[data-receipt="file-input"]').setInputFiles({name:'receipt.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.7\nfixture '+i)});
 await page.waitForFunction(()=>[...document.querySelectorAll('[data-receipt="notice"]')].every(n=>n.textContent.includes('保存待ち')));await save();
 assert.equal(new Set(receiptItems.filter(x=>x.state==='active').map(x=>x.refuel_id)).size,2);
 const links=receiptItems.filter(x=>x.state==='active').map(x=>({id:x.id,refuel_id:x.refuel_id}));
 const fuelIds=fuelRecords.map(x=>x.id),beforeRepeat=calls.length;
 await save();await save();
 assert.equal(calls.slice(beforeRepeat).filter(x=>x.table==='driving_refuels'&&x.method!=='GET').length,0);
 await rows.nth(0).locator('[data-refuel="liters"]').fill('12.5');
 await rows.nth(0).locator('[data-refuel="meter"]').fill('101');
 await rows.nth(1).locator('[data-refuel="liters"]').fill('15');
 await rows.nth(1).locator('[data-refuel="meter"]').fill('111');
 const beforeEdit=calls.length;await save();
 const fuelWrites=calls.slice(beforeEdit).filter(x=>x.table==='driving_refuels'&&x.method!=='GET');
 assert.deepEqual(fuelWrites.map(x=>x.method),['PATCH','PATCH']);
 assert.deepEqual(fuelRecords.map(x=>x.id),fuelIds);
 assert.deepEqual(receiptItems.filter(x=>x.state==='active').map(x=>({id:x.id,refuel_id:x.refuel_id})),links);
 await page.reload();await waitReady();await page.waitForFunction(()=>document.querySelectorAll('.receipt-preview a').length===2);
 assert.equal(await rows.nth(0).locator('[data-refuel="liters"]').inputValue(),'12.5');
 assert.equal(await rows.nth(1).locator('[data-refuel="meter"]').inputValue(),'111');
 assert.deepEqual(receiptItems.filter(x=>x.state==='active').map(x=>({id:x.id,refuel_id:x.refuel_id})),links);
 await page.locator('#vehicleId').selectOption('2');await save();await page.reload();await waitReady();
 assert.equal(await page.locator('#vehicleId').inputValue(),'2');assert.equal(await rows.count(),2);
 await page.locator('#outboundRoute').selectOption('direct');await page.locator('#returnRoute').selectOption('direct');await page.locator('#startOdometer').fill('90');await page.locator('#allGood').click();
 for(const p of ['alcohol','returnAlcohol']){await page.locator('#'+p+'Time').fill('08:00');await page.locator('#'+p+'Value').fill('0');await page.locator('#'+p+'Phone').selectOption('false');await page.locator('#'+p+'Confirmer').selectOption('中尾');}
 await page.locator('#endOdometer').fill('120');page.once('dialog',d=>d.accept());await page.locator('#saveDraft').click();await page.waitForFunction(()=>document.getElementById('drivingMessage').textContent.includes('日報を提出しました'));
 assert(await rows.first().locator('[data-receipt="choose"]').isDisabled());assert(await rows.first().locator('[data-receipt="remove"]').isDisabled());
 assert.equal(await page.evaluate(()=>window.receiptCameraCalls),0);
 assert.deepEqual(errors,[]);
 console.log('PASS receipt browser: desktop/390/320, native file chooser camera/retake and library selection/cancel, no custom camera API, full tall-image compression/preview, PDF select, HEIC fallback, upload failure retry, replacement/removal, separate refuel links, vehicle change, reload, submitted edit lock. iPhone hardware not tested.');
} finally {await browser.close();await new Promise(r=>server.close(r));}
