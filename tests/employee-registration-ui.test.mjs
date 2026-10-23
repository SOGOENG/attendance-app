// Local Chrome + mocked API. No real employee/Auth writes.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {pathToFileURL} from 'node:url';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:'playwright');
const server=createServer(async(req,res)=>{
 const file=new URL(req.url,'http://localhost').pathname.slice(1);
 if(!/^[a-z0-9.-]+$/i.test(file)){res.writeHead(404);return res.end();}
 try{res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html; charset=utf-8');res.end(await readFile(new URL('../'+file,import.meta.url)));}catch{res.writeHead(404);res.end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_PATH});
try{
 const page=await browser.newPage(),errors=[],calls=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>localStorage.setItem('portalLoginUser',JSON.stringify({id:1,adminScope:'all'})));
 const op='00000000-0000-4000-8000-000000000003';
 const employees=[{id:1,name:'管理者本人',department:'工事部',active:true,admin_scope:'all',driving_report_required:false}];
 let state='auth_bound',recoverFail=true,created=false;
 await page.route('**/*',async route=>{
  const req=route.request(),url=new URL(req.url()),name=url.pathname.split('/').at(-1);
  if(name==='portal-auth.js')return route.fulfill({contentType:'text/javascript',body:'const PORTAL_SUPABASE_URL="https://mock.invalid";window.portalFetch=(u,o)=>fetch(u,o);'});
  if(name==='employee-default-vehicle-admin.js')return route.fulfill({contentType:'text/javascript',body:'window.EmployeeVehicleAdmin={open(){},close(){}};'});
  if(url.hostname==='mock.invalid'||url.hostname.endsWith('.supabase.co')){
   const body=req.postData()?req.postDataJSON():null;calls.push({name,body,method:req.method()});
   const reply=(json,status=200)=>route.fulfill({status,json});
   if(name==='employee_edit_context')return reply({all:true,actor_id:1,registration_protocol:2,editable_ids:employees.map(e=>e.id),creation_enabled:true,creation_management_enabled:true});
   if(name==='employees'){assert.equal(req.method(),'GET');return reply(employees);}
   if(name==='fuel-receipts'){assert.equal(body.action,'access');return reply({admin:false});}
   assert.equal(name,'bright-service');
   if(body.action==='creation_status'){assert.equal(body.operationId,op);return reply({operations:[{operation_id:op,employee_id:3,state}]});}
   if(body.action==='recover_creation'){
    assert.equal(body.operationId,op);assert.equal(body.initialPassword,'recovery-secret');
    if(recoverFail)return reply({error:'解放結果は未確認です。再登録しないでください。'},409);
    state='completed';return reply({success:true,employeeId:3,operationId:op});
   }
   assert.equal(body.action,'create');assert.equal(body.initialPassword,'initial-secret');assert(body.operationId);
   assert(!('driving_report_required' in body));
   created=true;employees.push({...employees[0],id:4,name:body.name,admin_scope:'none'});
   return reply({success:true,employeeId:4,operationId:body.operationId});
  }
  assert.equal(url.hostname,'127.0.0.1');return route.continue();
 });
 await page.goto(`http://127.0.0.1:${server.address().port}/employee-admin.html`);
 await page.waitForFunction(()=>document.getElementById('newEmployeeButton').disabled===false);
 await page.locator('#employeeCreationOperationId').fill(op);
 await page.locator('#employeeCreationStatusButton').click();
 await page.waitForSelector('#employeeCreationStatusList input[type=password]');
 assert((await page.locator('#employeeCreationStatusList').innerText()).includes('隔離・紐付け済み'));
 for(const width of [1440,768,390,320]){
  await page.setViewportSize({width,height:1000});
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 }
 const password=page.locator('#employeeCreationStatusList input[type=password]');
 await password.fill('recovery-secret');page.once('dialog',d=>d.accept());
 await page.locator('#employeeCreationStatusList button').click();
 await page.waitForFunction(()=>document.getElementById('employeeCreationStatusMessage').textContent.includes('未確認'));
 assert.equal(await password.inputValue(),'');
 recoverFail=false;await password.fill('recovery-secret');page.once('dialog',d=>d.accept());
 await page.locator('#employeeCreationStatusList button').click();
 await page.waitForFunction(()=>document.getElementById('employeeCreationStatusMessage').textContent.includes('登録完了を確認'));
 assert.equal(await password.count(),0);
 await page.locator('#newEmployeeButton').click();
 await page.locator('#employeeName').fill('新規社員');
 await page.locator('#employeeInitialPassword').fill('initial-secret');
 page.once('dialog',d=>d.accept());await page.locator('#saveEmployeeButton').click();
 await page.waitForFunction(()=>document.getElementById('employeeMessage').textContent.includes('新規社員を登録しました'));
 assert(created);
 await page.locator('#employeeDepartmentFilter').selectOption('all');
 await page.locator('.admin-schedule-item').filter({hasText:'新規社員'}).locator('.edit-schedule-button').click();
 assert.equal(await page.locator('#editingEmployeeId').inputValue(),'4');
 const storage=await page.evaluate(()=>JSON.stringify({...localStorage}));
 assert(!storage.includes('initial-secret')&&!storage.includes('recovery-secret'));
 assert(calls.every(c=>c.method==='GET'||['employee_edit_context','bright-service','fuel-receipts'].includes(c.name)));
 assert.deepEqual(errors,[]);
 console.log('PASS protocol-2 UI: enabled creation, operation ID, masked limited recovery, failure/retry/completed, no password storage, post-create editing, PC/iPad/iPhone/320.');
}finally{await browser.close();await new Promise(r=>server.close(r));}
