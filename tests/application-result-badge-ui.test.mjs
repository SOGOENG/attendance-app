// PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node tests/application-result-badge-ui.test.mjs
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const browser = await chromium.launch({channel:'chrome', headless:true});
try {
  const page = await browser.newPage({viewport:{width:375,height:812}});
  const errors=[]; page.on('pageerror',e=>errors.push(e.message));
  let unread=[{history_id:11,application_id:1,result_status:'approved'},
    {history_id:12,application_id:2,result_status:'revision_required'}];
  let writes=[];
  await page.exposeFunction('resultRPC', (name,body) => {
    if(name==='get_unread_application_results') return unread;
    if(name==='mark_application_results_read') {
      writes.push(body.p_history_ids); unread=unread.filter(r=>!body.p_history_ids.includes(r.history_id)); return null;
    }
  });
  const fixture = `const PORTAL_SUPABASE_URL='https://test.invalid';
    localStorage.setItem('portalLoginUser',JSON.stringify({id:1}));
    function redirectToPortalLogin(){throw Error('unexpected redirect')}
    async function portalFetch(url,options={}){
      const name=new URL(url).pathname.split('/').pop(); let data=[];
      if(name==='get_unread_application_results'||name==='mark_application_results_read') data=await resultRPC(name,JSON.parse(options.body||'{}'));
      if(name==='can_use_application_features')data=true;
      if(name==='application_types')data=[{code:'paid_leave',display_name:'有給休暇'},{code:'comp_leave',display_name:'代休'}];
      if(name==='applications')data=[{id:1,application_type:'paid_leave',status:'approved',created_at:'2026-10-16',submitted_at:'2026-10-16'},
        {id:2,application_type:'comp_leave',status:'revision_required',created_at:'2026-10-16',submitted_at:'2026-10-16'}];
      if(name==='paid_leave_application_details')data=[{application_id:1,start_date:'2026-10-16',end_date:'2026-10-16',days:1}];
      if(name==='comp_leave_dates')data=[{application_id:2,leave_date:'2026-10-17',days:1}];
      return {ok:true,status:200,json:async()=>data,text:async()=>JSON.stringify(data)};
    }`;
  await page.route('**/*',async route=>{
    const url=new URL(route.request().url()); assert.equal(url.hostname,'local.test');
    const file=url.pathname.slice(1);
    if(file==='portal-auth.js')return route.fulfill({contentType:'text/javascript',body:fixture});
    // Unrelated menu/submission widgets are not part of this test.
    if(['side-menu.js','my-page.js'].includes(file))return route.fulfill({contentType:'text/javascript',body:''});
    try {await route.fulfill({contentType:file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html',
      body:await readFile(new URL('../'+file,import.meta.url))});}
    catch {await route.fulfill({status:404,body:''});}
  });
  await page.goto('http://local.test/my-page.html');
  const badge=page.locator('#applicationResultBadge');
  await badge.waitFor({state:'visible'}); assert.equal(await badge.textContent(),'2');
  assert.equal(writes.length,0);
  for(const width of [320,375,430]) {
    await page.setViewportSize({width,height:812});
    const box=await badge.boundingBox(); assert.ok(box.x>=0&&box.x+box.width<=width);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  }
  await page.screenshot({path:'tmp/application-result-badge-mobile.png',fullPage:true});
  await page.goto('http://local.test/applications.html');
  await page.locator('.application-item').first().waitFor({state:'attached'});
  assert.equal(writes.length,0); // History was loaded, but new-request tab is visible.
  await page.locator('[data-panel="history"]').click();
  await page.waitForFunction(()=>document.getElementById('historyPanel').hidden===false);
  await page.waitForTimeout(100);
  assert.deepEqual(writes,[[11,12]]);
  await page.goto('http://local.test/my-page.html');
  await page.waitForTimeout(100); assert.equal(await badge.isVisible(),false);
  unread=[{history_id:13,application_id:1,result_status:'approved'}];
  await page.reload(); await badge.waitFor({state:'visible'}); assert.equal(await badge.textContent(),'1');
  await page.locator('#applicationsMenu').click();
  await page.locator('#historyPanel').waitFor({state:'visible'});
  await page.waitForTimeout(100); assert.deepEqual(writes.at(-1),[13]);
  assert.deepEqual(errors,[]);
  console.log('PASS: 320/375/430px layout, 2/1/0 badge, entry read-only, hidden history not acknowledged, history tab acknowledgement, entry opens history, no JS errors');
} finally {await browser.close();}
