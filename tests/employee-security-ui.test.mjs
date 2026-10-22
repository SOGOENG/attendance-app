// Real Chrome, mocked APIs only; no Supabase connection.
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
 const context=await browser.newContext({viewport:{width:390,height:844}});
 const page=await context.newPage(),errors=[],writes=[];
 page.on('pageerror',e=>errors.push(e.message));
 let all=false,creationEnabled=true,conflict=false,attempts=[],creationSuccess=false,created=false,createdEmployee=null;
 const worker={id:3,name:'一般社員',department:'工事部',active:true,admin_scope:'none',is_leave_manager:false,
  attendance_required:true,improvement_required:true,near_miss_required:true,job_title:null,profile_email:null,phone_number:null};
 await page.context().addInitScript(()=>localStorage.setItem('portalLoginUser',JSON.stringify({id:2,adminScope:'工事部'})));
 await page.context().route('**/portal-auth.js',r=>r.fulfill({contentType:'text/javascript',body:'window.portalFetch=(url,opts)=>fetch(url,opts);const PORTAL_SUPABASE_URL="https://mock.invalid";'}));
 for(const script of ['employee-default-vehicle-admin.js','fuel-receipt-roles-admin.js'])await page.context().route('**/'+script+'*',r=>r.fulfill({contentType:'text/javascript',body:script==='employee-default-vehicle-admin.js'?'window.EmployeeVehicleAdmin={open(id){window.vehicleOpened=id},close(){}};':''}));
 const api=async route=>{
  const req=route.request(),name=new URL(req.url()).pathname.split('/').at(-1),body=req.postData()?req.postDataJSON():{};
  if(name==='employee_edit_context')return route.fulfill({json:{all,actor_id:all?1:2,creation_enabled:creationEnabled,department:all?null:'工事部',editable_ids:created?[3,4]:[3]}});
  if(name==='employees'){assert.equal(req.method(),'GET');return route.fulfill({json:created?[worker,createdEmployee]:[worker]});}
  if(['department_edit_employee','admin_edit_employee'].includes(name)){
   writes.push({name,body});
   if(conflict)return route.fulfill({status:409,json:{message:'employee_edit_conflict'}});
   const target=body.p_id===4?createdEmployee:worker;Object.assign(target,body.p_data);return route.fulfill({json:target});
  }
  if(name==='bright-service'){
   if(body.action==='creation_status')return route.fulfill({json:{creationEnabled:false,operations:[{employee_id:5,state:'recovery_required',operation_id:'00000000-0000-4000-8000-000000000005'}]}});
   assert.equal(body.action,'create');attempts.push(body);
   if(creationSuccess){created=true;createdEmployee={...worker,id:4,name:'登録成功社員'};return route.fulfill({json:{success:true,employeeId:4,operationId:body.operationId}});}
   return route.fulfill({status:409,json:{error:'復旧確認が必要です',operationId:body.operationId,recoveryRequired:true}});
  }
  throw Error('Unexpected API '+name);
 };
 await page.context().route('https://mock.invalid/**',api);await page.context().route('https://fgmvmbjnoyagnpygcbky.supabase.co/**',api);
 await page.goto('http://127.0.0.1:'+server.address().port+'/employee-admin.html');
 await page.locator('#employeeDepartmentFilter').selectOption('all');
 await page.locator('.edit-schedule-button').first().click();
 assert(await page.locator('#newEmployeeButton').isHidden());assert(await page.locator('#deleteEmployeeButton').isHidden());
 for(const id of ['employeeDepartment','employeeActive','employeeAdminScope'])assert(await page.locator('#'+id).isDisabled());
 await page.locator('#employeeName').fill('氏名訂正');await page.locator('#employeeAttendanceRequired').selectOption('false');
 const save=async()=>{page.once('dialog',d=>d.accept());await page.locator('#saveEmployeeButton').click();await page.waitForFunction(()=>!document.getElementById('saveEmployeeButton').disabled);};
 await save();assert.equal(worker.name,'氏名訂正');assert.equal(writes[0].name,'department_edit_employee');
 assert.deepEqual(Object.keys(writes[0].body.p_data).sort(),['name','attendance_required','improvement_required','near_miss_required'].sort());
 await page.locator('.edit-schedule-button').first().click();conflict=true;await save();
 assert(await page.locator('#employeeEditSection').isVisible());assert((await page.locator('#employeeMessage').textContent()).includes('変更されています'));
 all=true;conflict=false;await page.reload();await page.locator('#employeeDepartmentFilter').selectOption('all');
 await page.locator('#newEmployeeButton').click();await page.locator('#employeeName').fill('新規社員');await page.locator('#employeeInitialPassword').fill('private-password');
 await save();await save();assert.equal(attempts.length,2);assert.equal(attempts[0].operationId,attempts[1].operationId);
 assert(await page.locator('#employeeEditSection').isVisible());assert((await page.locator('#employeeMessage').textContent()).includes('操作ID'));
 assert(!(await page.evaluate(()=>JSON.stringify(localStorage))).includes('private-password'));
 // Different input gets its own operation; original pending UUID remains recorded.
 await page.locator('#employeeName').fill('別の社員');await save();assert.notEqual(attempts[2].operationId,attempts[0].operationId);
 const tab=await page.context().newPage();await tab.goto('http://127.0.0.1:'+server.address().port+'/employee-admin.html');
 const acquire=p=>p.evaluate(()=>EmployeeCreationState.acquire(1,{name:'同時登録',active:true}));
 const concurrent=await Promise.all([acquire(page),acquire(tab)]);assert.equal(concurrent[0].operationId,concurrent[1].operationId);
 const otherActor=await tab.evaluate(()=>EmployeeCreationState.acquire(9,{name:'同時登録',active:true}));assert.notEqual(otherActor.operationId,concurrent[0].operationId);
 await tab.close();
 // Isolated success path: context IDs must refresh before immediate editing.
 creationSuccess=true;await page.locator('#employeeName').fill('登録成功社員');
 page.on('dialog',async d=>{if(d.type()==='alert')await d.accept();});
 await save();await page.waitForFunction(()=>document.getElementById('employeeEditSection').hidden);
 await page.locator('#employeeDepartmentFilter').selectOption('all');await page.locator('.edit-schedule-button').nth(1).click();
 assert.equal(await page.locator('#employeeName').inputValue(),'登録成功社員');assert.equal(await page.evaluate(()=>window.vehicleOpened),4);
 await page.locator('#employeeName').fill('登録直後の訂正');await save();assert.equal(writes.at(-1).body.p_id,4);assert.equal(createdEmployee.name,'登録直後の訂正');
 // Safe production mode remains paused and can inspect recovery cases.
 creationEnabled=false;await page.reload();await page.waitForFunction(()=>!document.getElementById('employeeCreationRecovery').hidden);
 assert(await page.locator('#newEmployeeButton').isDisabled());await page.locator('#employeeCreationStatusButton').click();
 await page.waitForFunction(()=>document.getElementById('employeeCreationStatusList').textContent.includes('復旧確認'));
 assert((await page.locator('#employeeCreationNotice').textContent()).includes('停止中'));
 assert.deepEqual(errors,[]);
 console.log('PASS employee UI: department restrictions, immediate edit/vehicle after success, duplicate/different input, shared-tab operation IDs, actor separation, recovery lookup and production pause; no stored password.');
}finally{await browser.close();await new Promise(r=>server.close(r));}
