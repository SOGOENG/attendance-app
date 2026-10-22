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
 const receiptItems=[];let adminMode=false,roleEnabled=false,accountingMode=false;
 const receiptId='10000000-0000-0000-0000-000000000001';
 const adminRow={refuel_id:1,fuel_date:'2026-10-17',employee_id:1,employee_name:'社員A',vehicle_id:2,vehicle:'A-002',liters:10,odometer_km:100,state:'active',receipt_id:receiptId,bytes:200,received:false};
 const job={id:'90000000-0000-0000-0000-000000000001',month:'2026-10-01',created_at:'2026-10-17',actor_id:3,state:'generated',manifest:{files:[{id:receiptId,sha256:'a'.repeat(64),bytes:200}],rows:[{receipt_id:receiptId,saved_at:'2024-10-01'}]},candidates:[{id:receiptId,bytes:200}]};
 let nextId=1,failDetail=false,failLoad=false,defaultVehicle=1;
 let previousMeter=null,failMeter=false,meterDelay=0,denyMeter=false,failSubmit=false;
 await page.addInitScript(()=>{window.showSaveFilePicker=undefined;localStorage.setItem('portalLoginUser',JSON.stringify({id:999,name:'信用しないローカル情報'}));});
 await page.route('**/portal-auth.js',r=>r.fulfill({contentType:'text/javascript',body:'const PORTAL_SUPABASE_URL="https://mock.invalid";window.portalFetch=(url,opts)=>fetch(url,opts);window.redirectToPortalLogin=()=>{};'}));
 await page.route('https://mock.invalid/**',async route=>{
  const req=route.request(),url=new URL(req.url()),table=url.pathname.split('/').at(-1),method=req.method(),body=req.headers()['content-type']?.includes('application/json')?req.postDataJSON():null;
  calls.push({table,method,body,url:url.href});
  const respond=(result,status=200)=>route.fulfill({status,json:result});
  if(table==='fuel-receipts'){
   const action=body.action,d=body.data||{};
   if(action==='access')return respond({manager:adminMode||accountingMode,admin:adminMode});
   if(action==='roles'){if(!adminMode)return respond({error:'admin_required'},403);if(d.employee_id)roleEnabled=d.enabled;return respond([{id:1,name:'社員A',accounting:roleEnabled,admin:false},{id:3,name:'管理者',accounting:false,admin:true}]);}
   if(action==='list')return respond([adminRow]);
   if(action==='exports')return respond({jobs:[job],bytes:200,audit:[{happened_at:'2026-10-17',actor_id:3,event:'view',target:'receipt'}]});
   if(action==='review'){adminRow.received=d.received;return respond({});}
   if(action==='export'){job.state='generated';return route.fulfill({status:200,body:Buffer.from('PK fixture'),headers:{'Content-Type':'application/zip','X-Receipt-Export':job.id}});}
   if(action==='export_downloaded'){job.state='downloaded';return respond(job);}
   if(action==='backup'){job.backup_checked_at='2026-10-17';job.backup_location=d.location;return respond(job);}
   if(action==='approve'){job.approved_at='2026-10-17';return respond(job);}
   if(action==='archive'){adminRow.state='archived';job.candidates=[];return respond(d.ids.map(id=>({id,success:true})));}
   return respond({});
  }
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
  if(table==='employees')return respond([{id:1,name:'社員A',department:'工事部',active:true},{id:2,name:'社員B',department:'総務部',active:true},{id:4,name:'元社員',department:'工事部',active:false}]);
  if(table==='vehicles')return respond([{id:1,vehicle_number:'A-001',vehicle_name:'社用車'},{id:2,vehicle_number:'A-002',vehicle_name:'新車'},{id:3,vehicle_number:'A-002',vehicle_name:'予備車'}]);
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
 await page.goto(base+'/fuel-receipts-admin.html');
 await page.waitForFunction(()=>document.getElementById('receiptAdminMessage').textContent.includes('経理担当者'));
 assert(await page.locator('#receiptAdminContent').isHidden());adminMode=true;await page.reload();
 await page.waitForSelector('#receiptList article');
 assert.equal(await page.locator('#receiptDepartment').inputValue(),'');
 assert.equal(await page.locator('#receiptEmployee').inputValue(),'');
 assert.equal(await page.locator('#receiptVehicle').inputValue(),'');
 assert((await page.locator('#receiptVehicle option[value="2"]').innerText()).includes('新車'));
 assert((await page.locator('#receiptVehicle option[value="3"]').innerText()).includes('予備車'));
 await page.locator('#receiptEmployee').selectOption('1');
 await page.locator('#receiptDepartment').selectOption('総務部');
 assert.equal(await page.locator('#receiptEmployee').inputValue(),'');
 assert.deepEqual(await page.locator('#receiptEmployee option').evaluateAll(os=>os.map(o=>o.value)),['','2']);
 await page.locator('#receiptFilters button').click();
 await page.waitForFunction(()=>document.getElementById('receiptAdminMessage').textContent==='0件を表示しました。');
 assert.equal(await page.locator('#receiptList article').count(),0);
 await page.locator('#receiptDepartment').selectOption('工事部');
 await page.locator('#receiptFilters button').click();await page.waitForSelector('#receiptList article');
 assert.equal(calls.filter(c=>c.body?.action==='list').at(-1).body.data.employee_id,undefined);
 assert.deepEqual(await page.locator('#receiptEmployee option').evaluateAll(os=>os.map(o=>o.value)),['','1','4']);
 await page.locator('#receiptDepartment').selectOption('');
 assert.equal(await page.locator('#receiptBackupDetails').getAttribute('open'),null);
 assert.equal(await page.locator('#receiptAuditDetails').getAttribute('open'),null);
 assert(await page.locator('#receiptExport').isVisible());
 assert(await page.locator('#receiptBackupStatus').isVisible());
 assert((await page.locator('#receiptBackupStatus').innerText()).includes('バックアップ未確認 1件'));
 assert((await page.locator('#receiptBackupStatus').innerText()).includes('削除未承認 1件'));
 assert(await page.locator('#receiptAudit p').first().isHidden());
 const beforeToggle=calls.length;
 await page.locator('#receiptAuditDetails summary').click();assert(await page.locator('#receiptAudit p').first().isVisible());
 await page.locator('#receiptAuditDetails summary').focus();await page.keyboard.press('Enter');assert(await page.locator('#receiptAudit p').first().isHidden());
 assert.equal(calls.length,beforeToggle);
 for(const width of [1280,390,320]){
  await page.setViewportSize({width,height:900});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.locator('#receiptEmployee').selectOption('1');await page.locator('#receiptVehicle').selectOption('2');await page.locator('#receiptReceived').selectOption('false');await page.locator('#receiptMissing').check();
  await page.locator('#receiptFilters button').click();await page.waitForTimeout(50);
  const filters=calls.filter(c=>c.table==='fuel-receipts'&&c.body?.action==='list').at(-1).body.data;
  assert.equal(filters.employee_id,1);assert.equal(filters.vehicle_id,2);assert.equal(filters.received,false);assert.equal(filters.missing,true);
  await page.screenshot({path:join(tmpdir(),'fuel-receipts-admin-'+width+'.png'),fullPage:true});
 }
 page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'原本受領済みにする',exact:true}).click();
 await page.waitForSelector('button:text("原本受領を取り消す")');assert.equal(adminRow.received,true);
 page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'原本受領を取り消す',exact:true}).click();
 await page.waitForSelector('button:text("原本受領済みにする")');assert.equal(adminRow.received,false);
 const download=page.waitForEvent('download');page.once('dialog',d=>d.accept());await page.locator('#receiptExport').click();await download;
 await page.waitForFunction(()=>document.querySelector('#receiptJobs').textContent.includes('downloaded'));
 assert.equal(job.backup_checked_at,undefined);assert(!calls.some(c=>c.body?.action==='backup'));
 assert(await page.locator('#receiptExport').isVisible());
 await page.locator('#receiptBackupDetails summary').click();
 const jobCard=page.locator('.receipt-job');await jobCard.locator('input[type="text"]').fill('company/share/2026-10');
 await jobCard.locator('input[type="file"]').setInputFiles({name:'backup-verification.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({export_id:job.id,files:[{id:receiptId,sha256:'a'.repeat(64)}]}))});
 await jobCard.locator('input[type="checkbox"]').check();await page.getByRole('button',{name:'バックアップ件数・整合性の確認を記録'}).click();
 await page.waitForSelector('button:text("画像削除を承認")');
 assert((await page.locator('#receiptBackupStatus').innerText()).includes('バックアップ未確認 0件'));
 page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'画像削除を承認',exact:true}).click();
 await page.waitForSelector('button:text("1年経過ファイルを削除")');
 assert((await page.locator('#receiptBackupStatus').innerText()).includes('削除未承認 0件'));
 page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'1年経過ファイルを削除（最大25件ずつ）',exact:true}).click();
 await page.waitForFunction(()=>document.getElementById('receiptAdminMessage').textContent.includes('削除成功 1件'));
 assert((await page.locator('#receiptList').innerText()).includes('領収書画像はアーカイブ済み'));
 assert.equal(await page.locator('#receiptRoleSection').count(),0);
 assert(!calls.some(c=>c.body?.action==='roles'));
 accountingMode=true;adminMode=false;await page.reload();await page.waitForSelector('#receiptList article');
 assert.equal(await page.locator('#receiptRoleSection').count(),0);
 assert.deepEqual(errors,[]);
 console.log('PASS accounting UI: access denied employee, filters, original received/correction, ZIP saved acknowledgement separate from backup, proof/approval/manual archive workflow, audit display, PC/390/320. API/storage mocked.');
} finally {await browser.close();await new Promise(r=>server.close(r));}
