// Local browsers + intercepted APIs only. All non-local requests are mocked.
import assert from 'node:assert/strict';
import {readFile,mkdir} from 'node:fs/promises';
import {createServer} from 'node:http';
import {pathToFileURL,fileURLToPath} from 'node:url';
const {chromium,webkit}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const engine=process.env.LOGIN_BROWSER==='webkit'?webkit:chromium;
const server=createServer(async(req,res)=>{
 const name=new URL(req.url,'http://localhost').pathname.slice(1);
 if(!/^[a-z0-9.-]+$/i.test(name)){res.writeHead(404);return res.end();}
 try{res.setHeader('Content-Type',name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':'text/html; charset=utf-8');res.end(await readFile(new URL('../'+name,import.meta.url)));}
 catch{res.writeHead(404);res.end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await engine.launch({headless:true,...(process.env.BROWSER_PATH?{executablePath:process.env.BROWSER_PATH}:{})});
const base=`http://127.0.0.1:${server.address().port}`;
const userId='00000000-0000-4000-8000-000000000035';
const employee={id:35,name:'確認用社員',department:'工事部',active:true,admin_scope:'none',is_leave_manager:false,auth_user_id:userId};
let groups=0;
async function setup(options={}){
 const page=await browser.newPage();const calls=[],errors=[],logs=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>logs.push(m.text()));
 await page.route('**/*',async route=>{
  const req=route.request(),url=new URL(req.url());
  if(url.hostname.endsWith('.supabase.co')){
   calls.push({path:url.pathname,method:req.method(),query:url.search,body:req.postData(),headers:req.headers()});
   if(url.pathname==='/auth/v1/token'){
    assert.equal(req.method(),'POST');
    const body=req.postDataJSON();assert.equal(body.email,'employee-35@staff-portal.local');assert.equal(body.password,'unchanged-secret');
    if(options.hold)await options.hold;
    if(options.network)return route.abort();
    if(options.authStatus)return route.fulfill({status:options.authStatus,json:{error_description:options.error||'PRIVATE_AUTH_REASON'}});
    return route.fulfill({json:options.authBody||{access_token:'mock-jwt',refresh_token:'mock-refresh',expires_in:3600,user:{id:userId}}});
   }
   if(url.pathname==='/rest/v1/employees'){
    assert.equal(req.headers().authorization,'Bearer mock-jwt','anonymous SELECT denied');
    assert.equal(url.searchParams.get('auth_user_id'),`eq.${userId}`);
    assert.equal(url.searchParams.get('limit'),'2');
    assert.equal(url.searchParams.get('select'),'id,name,department,active,admin_scope,is_leave_manager,auth_user_id');
    const stored=await page.evaluate(()=>({user:localStorage.getItem('portalLoginUser'),session:localStorage.getItem('portalAuthSession')}));
    assert.deepEqual(stored,{user:null,session:null},'nothing stored before employee verification');
    return route.fulfill({status:options.employeeStatus||200,json:options.rows||[{...employee,...options.employee}]});
   }
   if(url.pathname==='/auth/v1/logout'){
    assert.equal(url.searchParams.get('scope'),'local');assert.equal(req.method(),'POST');
    return route.fulfill({status:204});
   }
   throw Error('Unexpected production API request: '+url.pathname);
  }
  assert.equal(url.hostname,'127.0.0.1','no external requests');
  if(url.pathname==='/home.html')return route.fulfill({contentType:'text/html',body:'<p>Mock home</p>'});
  return route.continue();
 });
 await page.goto(base+'/login.html');await page.waitForLoadState('networkidle');
 assert.equal(calls.length,0,'initial page has no API requests');
 return {page,calls,errors,logs};
}
async function fill(page,id='35'){
 await page.locator('#loginEmployee').fill(id);await page.locator('#loginPassword').fill('unchanged-secret');
}
try{
 for(const [scope,leave] of [['all',false],['工事部',false],['none',false],['none',true]]){
  const {page,calls,errors}=await setup({employee:{admin_scope:scope,is_leave_manager:leave}});
  await fill(page,'００３５');await page.locator('#loginPassword').press('Enter');
  await page.waitForURL('**/home.html');
  const s=await page.evaluate(()=>({user:JSON.parse(localStorage.getItem('portalLoginUser')),session:JSON.parse(localStorage.getItem('portalAuthSession')),all:JSON.stringify(localStorage)}));
  assert.equal(s.user.adminScope,scope);assert.equal(s.user.isLeaveManager,leave);assert.equal(s.user.id,35);
  assert.equal(s.session.accessToken,'mock-jwt');assert.equal(s.session.refreshToken,'mock-refresh');
  assert(!s.all.includes('unchanged-secret'));assert.deepEqual(calls.map(x=>x.path),['/auth/v1/token','/rest/v1/employees']);
  assert.deepEqual(errors,[]);await page.close();
 }
 console.log('PASS admin/dept/employee/leave roles, existing session contract, Enter, fullwidth/zero-padded IDs');groups++;
 let message;
 for(const options of [
  {authStatus:400,error:'invalid_credentials'}, {authStatus:400,error:'email_not_confirmed'},
  {authStatus:403,error:'user_banned'}, {authStatus:429}, {authStatus:500}, {network:true},
  {rows:[]}, {rows:[employee,employee]}, {employee:{active:false}}, {employee:{id:36}},
  {employee:{auth_user_id:'00000000-0000-4000-8000-000000000036'}},
  {employeeStatus:401}, {employeeStatus:403}, {employeeStatus:500},
  {authBody:{access_token:'mock-jwt',user:{id:'invalid'}}}
 ]){
  const {page,calls,logs,errors}=await setup(options);await fill(page);await page.locator('#loginButton').click();
  await page.waitForFunction(()=>document.getElementById('loginMessage').textContent&&!document.getElementById('loginButton').disabled);
  const actual=await page.locator('#loginMessage').innerText();message??=actual;assert.equal(actual,message);
  assert.equal(await page.locator('#loginPassword').inputValue(),'');
  assert.equal(await page.evaluate(()=>localStorage.getItem('portalAuthSession')),null);
  assert.equal(await page.evaluate(()=>localStorage.getItem('portalLoginUser')),null);
  assert(!logs.join('').includes('PRIVATE_AUTH_REASON'));assert(!logs.join('').includes('unchanged-secret'));
  if(options.authStatus||options.network||options.authBody)assert.equal(calls.length,1);
  else assert.equal(calls.at(-1).path,'/auth/v1/logout');
  assert.deepEqual(errors,[]);await page.close();
 }
 console.log('PASS 15 rejection/network cases share generic message, no session, no secret logs, local logout');groups++;
 const invalid=await setup();
 for(const id of ['0','-1','1e2','35&select=*','9007199254740992']){
  await fill(invalid.page,id);await invalid.page.locator('#loginButton').click();
  assert.equal(await invalid.page.locator('#loginMessage').innerText(),message);assert.equal(invalid.calls.length,0);
 }
 await invalid.page.close();
 console.log('PASS invalid/injected/unsafe IDs rejected without lookup');groups++;
 let release;const hold=new Promise(r=>release=r);
 const repeated=await setup({hold});await fill(repeated.page);
 await repeated.page.locator('#loginButton').click();
 await repeated.page.evaluate(()=>{for(let i=0;i<4;i++)document.getElementById('loginForm').dispatchEvent(new Event('submit',{cancelable:true}));});
 assert.equal(repeated.calls.length,1);release();await repeated.page.waitForURL('**/home.html');await repeated.page.close();
 console.log('PASS duplicate submit prevented');groups++;
 const visual=await setup();
 const out=new URL('../tmp/login-private/',import.meta.url);await mkdir(out,{recursive:true});
 for(const width of [1440,768,390,320]){
  await visual.page.setViewportSize({width,height:900});
  assert(await visual.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  for(const id of ['loginEmployee','loginPassword','loginButton']){
   const box=await visual.page.locator('#'+id).boundingBox();assert(box.height>=44&&box.width>150);
  }
  await visual.page.screenshot({path:fileURLToPath(new URL(`${process.env.LOGIN_BROWSER||'chromium'}-${width}.png`,out))});
 }
 assert.deepEqual(visual.errors,[]);await visual.page.close();
 console.log('PASS PC/iPad/iPhone/320px layout and touch sizes');groups++;
 console.log(`${groups} groups passed; no real Auth or DB access.`);
}finally{await browser.close();await new Promise(r=>server.close(r));}
