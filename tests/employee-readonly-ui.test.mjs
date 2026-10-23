// Real page scripts, local server, mocked authenticated APIs. No production traffic.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {pathToFileURL} from 'node:url';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:'playwright');
const server=createServer(async(req,res)=>{
 const f=new URL(req.url,'http://localhost').pathname.slice(1);
 if(!/^[a-z0-9.-]+$/i.test(f)){res.writeHead(404);return res.end();}
 try{res.setHeader('Content-Type',f.endsWith('.js')?'text/javascript':f.endsWith('.css')?'text/css':'text/html; charset=utf-8');res.end(await readFile(new URL('../'+f,import.meta.url)));}catch{res.writeHead(404);res.end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_PATH});
try{
 const page=await browser.newPage(),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{
  localStorage.setItem('portalLoginUser',JSON.stringify({id:1,adminScope:'all'}));
  localStorage.setItem('portalAuthSession',JSON.stringify({accessToken:'local-token',refreshToken:'local-refresh',expiresAt:Date.now()+3600000}));
 });
 const worker={id:1,name:'テスト社員',department:'工事部',active:true,admin_scope:'all',auth_user_id:'local-user',is_leave_manager:false,driving_report_required:false,attendance_required:true,improvement_required:true,near_miss_required:true,job_title:null,profile_email:null,phone_number:null};
 let mode='missing',selectDenied=false,calls=[];
 await page.route('**/*',async route=>{
  const req=route.request(),url=new URL(req.url());
  if(url.pathname==='/login.js')return route.fulfill({contentType:'text/javascript',body:''});
  if(url.hostname.endsWith('.supabase.co')){
   const name=url.pathname.split('/').at(-1);calls.push({name,method:req.method()});
   const reply=(json,status=200)=>route.fulfill({status,json});
   if(name==='token')return reply({message:'invalid refresh'},401);
   assert.equal(req.headers().authorization,'Bearer local-token');
   if(name==='employee_edit_context'){
    const failures={missing:[404,'PGRST202'],denied:[403,'42501'],auth:[401,'PGRST301'],other404:[404,'OTHER'],server:[500,'XX000'],wrongStatus:[403,'PGRST202']};
    if(failures[mode]){const [status,code]=failures[mode];return reply({code,message:'mock error'},status);}
    if(mode==='network')return route.abort();
    if(mode==='invalid')return reply({});
    return reply({all:true,actor_id:1,editable_ids:[1],creation_enabled:false,creation_management_enabled:false});
   }
   if(name==='employees'){assert.equal(req.method(),'GET');return selectDenied?reply({code:'42501'},403):reply([worker]);}
   if(name==='admin_edit_employee'){Object.assign(worker,req.postDataJSON().p_data);return reply(worker);}
   if(name==='admin_get_vehicle_master')return reply({vehicles:[],employees:[worker]});
   if(name==='fuel-receipts'){assert.equal(req.postDataJSON().action,'access');return reply({admin:false,manager:false});}
   throw Error('Unexpected API '+name);
  }
  assert.equal(url.hostname,'127.0.0.1');return route.continue();
 });
 const url=`http://127.0.0.1:${server.address().port}/employee-admin.html`;
 async function load(){calls=[];await page.goto(url);await page.waitForLoadState('networkidle');}
 await load();
 assert((await page.locator('#employeeMessage').innerText()).includes('閲覧専用'));
 assert.equal(await page.evaluate(()=>employeeRecords.length),1);
 await page.locator('#employeeDepartmentFilter').selectOption('all');
 assert.equal(await page.locator('.admin-schedule-item').count(),1);
 assert(await page.locator('.edit-schedule-button').isHidden());
 assert(await page.locator('#newEmployeeButton').isHidden());
 assert(await page.locator('#employeeEditSection').isHidden());
 assert.equal(await page.locator('#employeeEditSection input:enabled,#employeeEditSection select:enabled,#employeeEditSection button:enabled').count(),0);
 const before=calls.length;
 await page.evaluate(async()=>{
  startEmployeeEdit(employeeRecords[0]);startNewEmployeeRegistration();
  document.getElementById('saveEmployeeButton').disabled=false;
  await saveEmployee();await resetEmployeePassword();await deleteEmployeeAccount();
  for(const fn of [()=>updateExistingEmployee(1,{}),()=>updateEmployeeProfileAsAdmin(1),()=>createNewEmployeeAccount({})]){try{await fn();}catch{}}
  await window.EmployeeVehicleAdmin.open(1);
  document.getElementById('employeeVehicleSave').disabled=false;
  document.getElementById('employeeVehicleSave').click();
 });
 assert.equal(calls.length,before,'read-only actions must not issue network writes or role/vehicle requests');
 assert.equal(await page.evaluate(()=>isAllEmployeeAdministrator()),false,'local all flag is not editing authority');
 for(const width of [1440,768,390,320]){
  await page.setViewportSize({width,height:1000});
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 }
 selectDenied=true;await load();
 assert.equal(await page.evaluate(()=>employeeRecords.length),0);
 assert((await page.locator('#employeeMessage').innerText()).includes('権限'));
 selectDenied=false;
 for(mode of ['denied','auth','other404','server','wrongStatus','network','invalid']){
  await load();
  assert(!calls.some(c=>c.name==='employees'),`unexpected SELECT fallback: ${mode}`);
  if(mode==='auth'){assert(page.url().endsWith('/login.html'));continue;}
  assert.equal(await page.evaluate(()=>employeeRecords.length),0);
  if(mode!=='auth')assert((await page.locator('#employeeMessage').innerText()).length>0,mode);
 }
 mode='success';await load();
 assert.equal(await page.evaluate(()=>employeeReadOnly),false);
 await page.locator('#employeeDepartmentFilter').selectOption('all');
 assert(await page.locator('.edit-schedule-button').isEnabled());
 await page.locator('.edit-schedule-button').click();
 await page.locator('#employeeName').fill('安全なRPC編集');
 page.once('dialog',d=>d.accept());await page.locator('#saveEmployeeButton').click();
 await page.waitForFunction(()=>document.getElementById('employeeMessage').textContent.includes('保存しました'));
 assert.equal(worker.name,'安全なRPC編集');
 assert(calls.some(c=>c.name==='admin_edit_employee'));
 mode='missing';calls=[];await page.evaluate(()=>refreshEmployeeManagement());
 assert.equal(await page.evaluate(()=>employeeReadOnly),true);
 assert(await page.locator('#employeeEditSection').isHidden());
 mode='success';await page.evaluate(()=>refreshEmployeeManagement());
 assert.equal(await page.evaluate(()=>employeeReadOnly),false);
 assert(await page.locator('#saveEmployeeButton').isEnabled());
 assert.deepEqual(errors,[]);
 console.log('PASS: only 404/PGRST202 falls back; real authenticated SELECT, denied SELECT, forged local admin, all mutation/vehicle gates, 7 nonfallback errors, RPC recovery and safe editing, PC/iPad/iPhone/320.');
}finally{await browser.close();await new Promise(r=>server.close(r));}
