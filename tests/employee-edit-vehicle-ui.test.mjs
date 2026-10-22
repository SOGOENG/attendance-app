// Local mocked API only; no production connection.
// PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs BROWSER_PATH=/path/to/chrome node this-file
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const root = fileURLToPath(new URL('../', import.meta.url));
const server = createServer(async (req, res) => {
  const file = new URL(req.url, 'http://localhost').pathname.slice(1);
  if (!/^[a-z0-9.-]+$/i.test(file)) { res.writeHead(404); return res.end(); }
  try {
    res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html; charset=utf-8');
    res.end(await readFile(join(root, file)));
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_PATH ? { executablePath: process.env.BROWSER_PATH } : {}) });


try {
 const page=await browser.newPage({viewport:{width:1200,height:900}});const errors=[],calls=[];let failSave=false,failLoad=false;
 page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>localStorage.setItem('portalLoginUser',JSON.stringify({id:1,name:'管理者',adminScope:'all'})));
 await page.route('**/portal-auth.js',r=>r.fulfill({contentType:'text/javascript',body:'const PORTAL_SUPABASE_URL="https://mock.invalid";window.portalFetch=(url,opts)=>fetch(url,opts);'}));
 const employees=[{id:2,name:'社員B',department:'工事部',active:true,admin_scope:'none',auth_user_id:'b',job_title:'担当',profile_email:'b@example.test',phone_number:'090',default_vehicle_id:1,attendance_required:true,improvement_required:true,near_miss_required:true},{id:3,name:'社員C',department:'工事部',active:true,default_vehicle_id:2}];
 const vehicles=[{id:1,vehicle_number:'名古屋 400 あ 12-34',vehicle_name:'ハイエース',active:true},{id:2,vehicle_number:'名古屋 400 あ 56-78',vehicle_name:'バン',active:true}];
 const assignments=()=>employees.filter(e=>e.default_vehicle_id!=null).map(e=>({employee_id:e.id,vehicle_id:e.default_vehicle_id}));
 await page.route('**/rest/v1/**',async route=>{const req=route.request(),url=new URL(req.url()),name=url.pathname.split('/').at(-1),body=req.postData()?req.postDataJSON():null;calls.push({name,method:req.method(),body});
  if(name==='employee_edit_context')return route.fulfill({json:{all:true,actor_id:1,creation_enabled:true,editable_ids:employees.map(e=>e.id)}});
  if(name==='employees')return route.fulfill({json:employees});
  if(name==='admin_get_vehicle_master')return route.fulfill(failLoad?{status:403,json:{message:'application_admin_required'}}:{json:{vehicles,employees,assignments:assignments()}});
  if(name==='admin_set_employee_managed_vehicle'){
   if(failSave)return route.fulfill({status:409,json:{message:'vehicle_assignments_changed'}});
   let car=vehicles.find(v=>v.vehicle_number===body.p_vehicle_number);if(!car){car={id:vehicles.length+1,vehicle_number:body.p_vehicle_number,vehicle_name:body.p_vehicle_name,active:true};vehicles.push(car);}
   const target=employees.find(e=>e.id===body.p_employee_id),source=employees.find(e=>e.id!==target.id&&e.default_vehicle_id===car.id);
   if(source)source.default_vehicle_id=null;
   if(target.default_vehicle_id&&target.default_vehicle_id!==car.id)vehicles.find(v=>v.id===target.default_vehicle_id).active=false;
   target.default_vehicle_id=car.id;
   return route.fulfill({json:car.id});
  }
  throw Error('Unexpected '+req.method()+' '+url);
 });
 await page.goto('http://127.0.0.1:'+server.address().port+'/employee-admin.html');
 await page.locator('#employeeDepartmentFilter').selectOption('all');await page.locator('.edit-schedule-button').first().click();
 const ready=()=>page.waitForFunction(()=>!document.getElementById('employeeManagedVehicleNumber').disabled);
 await ready();assert.equal(await page.locator('#employeeManagedVehicleNumber').inputValue(),'名古屋 400 あ 12-34');
 assert.equal(await page.locator('#employeeManagedVehicleName').inputValue(),'ハイエース');assert.equal(await page.locator('#employeeDefaultVehicle').count(),0);
 assert.equal(await page.locator('a[href="vehicle-admin.html"]').count(),0);
 assert(await page.evaluate(()=>{
  const phone=document.getElementById('employeePhoneNumber'),section=document.getElementById('employeeVehicleSection'),password=document.getElementById('employeeInitialPasswordWrap');
  return !!(phone.compareDocumentPosition(section)&Node.DOCUMENT_POSITION_FOLLOWING)&&!!(section.compareDocumentPosition(password)&Node.DOCUMENT_POSITION_FOLLOWING);
 }));
 await page.locator('#employeeManagedVehicleNumber').fill('名古屋 400 あ 99-99');await page.locator('#employeeManagedVehicleName').fill('新車');
 page.once('dialog',d=>d.accept());await page.locator('#employeeVehicleSave').click();
 await page.waitForFunction(()=>document.getElementById('employeeVehicleMessage').textContent.includes('保存しました'));
 assert.equal(employees[0].default_vehicle_id,3);assert.equal(vehicles[0].active,false);
 assert.equal(await page.locator('#employeeProfileEmail').inputValue(),'b@example.test');
 await page.locator('#employeeManagedVehicleNumber').fill(vehicles[1].vehicle_number);await page.locator('#employeeManagedVehicleName').fill('バン');
 const before=calls.filter(c=>c.name==='admin_set_employee_managed_vehicle').length;
 let confirmMessage='';page.once('dialog',async d=>{confirmMessage=d.message();await d.dismiss();});await page.locator('#employeeVehicleSave').click();
 assert(confirmMessage.includes('社員C'));assert(confirmMessage.includes('未設定になります'));assert.equal(calls.filter(c=>c.name==='admin_set_employee_managed_vehicle').length,before);
 page.once('dialog',d=>d.accept());await page.locator('#employeeVehicleSave').click();await ready();
 await page.waitForFunction(()=>document.getElementById('employeeVehicleMessage').textContent.includes('保存しました'));
 assert.equal(employees[0].default_vehicle_id,2);assert.equal(employees[1].default_vehicle_id,null);
 assert.equal(calls.findLast(c=>c.name==='admin_set_employee_managed_vehicle').body.p_expected_source_employee_id,3);
 await page.screenshot({path:join(tmpdir(),'employee-vehicle-desktop.png'),fullPage:true});
 for(const width of [390,320]){await page.setViewportSize({width,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));}
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:join(tmpdir(),'employee-vehicle-mobile.png'),fullPage:true});
 await page.locator('#employeeManagedVehicleName').fill('別名');await page.locator('#employeeVehicleSave').click();await page.waitForFunction(()=>document.getElementById('employeeVehicleMessage').textContent.includes('異なる車両名'));
 await page.locator('#employeeManagedVehicleNumber').fill('新番号');await page.locator('#employeeManagedVehicleName').fill('新車');failSave=true;
 page.once('dialog',d=>d.accept());await page.locator('#employeeVehicleSave').click();await page.waitForFunction(()=>document.getElementById('employeeVehicleMessage').textContent.includes('再読み込みしてください'));failSave=false;
 page.once('dialog',d=>d.accept());await page.locator('#employeeVehicleReload').click();await ready();assert.equal(await page.locator('#employeeManagedVehicleName').inputValue(),'バン');
 await page.locator('#newEmployeeButton').click();assert(await page.locator('#employeeVehicleSection').isHidden());
 await page.locator('.edit-schedule-button').first().click();await ready();failLoad=true;await page.locator('#employeeVehicleReload').click();
 await page.waitForFunction(()=>document.getElementById('employeeVehicleMessage').textContent.includes('全体管理者'));assert(await page.locator('#employeeVehicleSave').isDisabled());
 assert(!calls.some(c=>c.name==='employees'&&c.method!=='GET'));assert(!calls.some(c=>c.name==='set_my_default_vehicle'));
 assert.deepEqual(errors,[]);console.log('PASS employee managed vehicle UI: placement, direct registration, transfer source/unset confirmation, cancellation, existing-name guard, conflict, admin errors, PC/mobile.');
} finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
