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
 const page=await browser.newPage({viewport:{width:1280,height:900}});
 const errors=[],calls=[];let full=true,enabled=false,failRole=false,failProfile=false,failRoleLoad=false;
 const employee={id:2,name:'社員B',department:'工事部',active:true,admin_scope:'none',attendance_required:true,improvement_required:true,near_miss_required:true};
 page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>localStorage.setItem('portalLoginUser',JSON.stringify({id:1,adminScope:'all'})));
 await page.route('**/portal-auth.js',r=>r.fulfill({contentType:'text/javascript',body:'const PORTAL_SUPABASE_URL="https://mock.invalid";window.portalFetch=(url,opts)=>fetch(url,opts);'}));
 await page.route('**/employee-default-vehicle-admin.js*',r=>r.fulfill({contentType:'text/javascript',body:''}));
 const api=async route=>{
  const req=route.request(),url=new URL(req.url()),name=url.pathname.split('/').at(-1),body=req.postData()?req.postDataJSON():{};
  calls.push({name,method:req.method(),body});
  if(name==='fuel-receipts'){
   if(body.action==='access')return route.fulfill({json:{admin:full,manager:true}});
   if(body.action==='roles'){
    if(!full||failRoleLoad)return route.fulfill({status:403,json:{error:'admin_required'}});
    if(body.data?.employee_id){if(failRole)return route.fulfill({status:500,json:{error:'role save failed'}});enabled=body.data.enabled;}
    return route.fulfill({json:[{id:2,name:employee.name,accounting:enabled,admin:employee.admin_scope==='all'}]});
   }
  }
  if(name==='employee_edit_context')return route.fulfill({json:{all:true,actor_id:1,creation_enabled:true,editable_ids:[2]}});
  if(name==='admin_edit_employee'){
   if(failProfile)return route.fulfill({status:500,json:{error:'profile failed'}});
   Object.assign(employee,body.p_data);return route.fulfill({json:employee});
  }
  if(name==='employees'){
   assert.equal(req.method(),'GET');
   return route.fulfill({json:[employee]});
  }
  throw Error('Unexpected request '+name);
 };
 await page.route('https://mock.invalid/**',api);
 await page.route('https://fgmvmbjnoyagnpygcbky.supabase.co/**',api);
 await page.goto('http://127.0.0.1:'+server.address().port+'/employee-admin.html');
 await page.locator('#employeeDepartmentFilter').selectOption('all');
 const open=async()=>{await page.locator('.edit-schedule-button').first().click();await page.waitForFunction(()=>!document.getElementById('employeeFuelReceiptRole').disabled);};
 const save=async()=>{page.once('dialog',d=>d.accept());await page.locator('#saveEmployeeButton').click();await page.waitForFunction(()=>!document.getElementById('saveEmployeeButton').disabled);};
 const writes=()=>calls.filter(c=>c.body?.action==='roles'&&c.body?.data?.employee_id);
 await open();assert.equal(await page.locator('#fuelReceiptRoleSection').count(),0);
 assert.equal(await page.locator('#employeeFuelReceiptRole').inputValue(),'none');
 assert(await page.evaluate(()=>!!(document.getElementById('employeeNearMissRequired').compareDocumentPosition(document.getElementById('employeeFuelReceiptRole'))&Node.DOCUMENT_POSITION_FOLLOWING)));
 for(const width of [1280,390,320]){await page.setViewportSize({width,height:900});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));}
 await save();assert.equal(writes().length,0);
 await open();await page.locator('#employeeFuelReceiptRole').selectOption('accounting');await save();assert.equal(enabled,true);assert.equal(employee.admin_scope,'none');assert(await page.locator('#employeeEditSection').isHidden());
 await open();assert.equal(await page.locator('#employeeFuelReceiptRole').inputValue(),'accounting');const before=writes().length;await save();assert.equal(writes().length,before);
 await open();await page.locator('#employeeFuelReceiptRole').selectOption('none');await save();assert.equal(enabled,false);
 await open();await page.locator('#employeeFuelReceiptRole').selectOption('accounting');await page.locator('#employeeName').fill('保存済み氏名');failRole=true;await save();
 assert.equal(employee.name,'保存済み氏名');assert.equal(enabled,false);assert(await page.locator('#employeeEditSection').isVisible());assert((await page.locator('#employeeMessage').textContent()).includes('社員情報は保存済みですが'));assert.equal(await page.locator('#employeeFuelReceiptRole').inputValue(),'accounting');
 failRole=false;await save();assert.equal(enabled,true);
 await open();await page.locator('#employeeFuelReceiptRole').selectOption('none');failProfile=true;const beforeFail=writes().length;await save();assert.equal(writes().length,beforeFail);failProfile=false;
 await open();await page.locator('#employeeAdminScope').selectOption('all');await page.locator('#employeeFuelReceiptRole').selectOption('none');await save();assert.equal(enabled,false);assert.equal(employee.admin_scope,'all');
 await page.locator('#newEmployeeButton').click();assert(await page.locator('#fuelReceiptRoleField').isHidden());
 full=false;await page.locator('.edit-schedule-button').first().click();await page.waitForTimeout(100);assert(await page.locator('#fuelReceiptRoleField').isHidden());
 assert.deepEqual(errors,[]);
 console.log('PASS individual employee receipt role: PC/390/320, placement, load, grant/revoke, unchanged no writes, independent admin scope, partial failure preserved, profile failure no role writes, admin without membership, new/nonadmin hidden. APIs mocked.');
} finally {await browser.close();await new Promise(r=>server.close(r));}
