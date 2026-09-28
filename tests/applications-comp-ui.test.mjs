// PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node tests/applications-comp-ui.test.mjs
// Headless browser with local files and mocked API. Never contacts Supabase.
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE
  ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 375, height: 812 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const work = Array.from({ length: 31 }, (_, index) => ({
    id: index + 1, work_date: `2026-08-${String(index+1).padStart(2,'0')}`,
    available_days: 1, reserved_days: 0, remaining_days: 1, site_id: 1,
  })).reverse();
  const reason = '家庭の事情 <script>未実行</script>';
  const fixture = `
    const PORTAL_SUPABASE_URL='https://test.invalid';
    localStorage.setItem('portalLoginUser',JSON.stringify({id:7}));
    window.writes=[];
    function redirectToPortalLogin(){throw Error('unexpected login redirect')}
    async function portalFetch(url,options={}){
      const p=new URL(url).pathname.split('/').pop();
      const body=JSON.parse(options.body||'{}');
      if(options.method==='POST' && !p.startsWith('get_') && p!=='can_use_application_features')window.writes.push({p,body});
      let data=[];
      if(p==='can_use_application_features'||p==='is_application_admin')data=true;
      if(p==='get_comp_leave_availability')data=${JSON.stringify([...work,{id:99,work_date:'2026-07-01',available_days:0}])};
      if(p==='application_types')data=[{code:'paid_leave',display_name:'有給休暇'},{code:'comp_leave',display_name:'代替休日'}];
      if(p==='site_master_order')data=[{id:1,display_name:'非常に長い現場名'.repeat(20)}];
      if(p==='paid_leave_balances')data=[{remaining_days:8}];
      if(p==='applications')data=options.method==='POST'?[{id:88}]:[{id:10,employee_id:7,application_type:'comp_leave',status:'revision_required',created_at:'2026-09-01',submitted_at:'2026-09-01'}];
      if(p==='comp_leave_application_details')data=[{application_id:10,note:${JSON.stringify(reason)}}];
      if(p==='comp_leave_dates')data=[{application_id:10,leave_date:'2026-09-10',days:1}];
      if(p==='comp_leave_allocations')data=[{holiday_work_record_id:26,allocated_days:1}];
      if(p==='applications' && location.pathname.includes('application-print'))data=[{id:10,employee_id:7,application_type:'comp_leave',status:'approved',submitted_at:'2026-09-01',approved_at:'2026-09-02',approved_by_employee_id:1}];
      if(p==='employees')data=[{id:7,name:'対象社員'},{id:1,name:'承認者'}];
      if(p==='holiday_work_records')data=[{id:26,work_date:'2026-08-26'}];
      return {ok:true,text:async()=>JSON.stringify(data)};
    }
  `;
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if(url.hostname !== 'local.test') throw Error('Unexpected network: '+url);
    const file = decodeURIComponent(url.pathname).slice(1);
    if(file==='portal-auth.js')return route.fulfill({contentType:'text/javascript',body:fixture});
    if(file==='side-menu.js')return route.fulfill({contentType:'text/javascript',body:''});
    const contentType=file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html';
    try { await route.fulfill({contentType,body:await readFile(new URL('../'+file,import.meta.url))}); }
    catch { await route.fulfill({status:404,body:''}); }
  });
  await page.goto('http://local.test/applications.html');
  await page.locator('[data-type="comp_leave"]').click();
  const rows=page.locator('#workAllocations .allocation-row:visible');
  assert.equal(await rows.count(),5);
  assert.deepEqual(await rows.locator('strong').allTextContents(),['2026/08/01','2026/08/02','2026/08/03','2026/08/04','2026/08/05']);
  assert.equal(await page.locator('[data-record="99"]').count(),0);
  await page.locator('[data-record="1"]').selectOption('0.5');
  await page.locator('#showMoreWork').click();
  assert.equal(await rows.count(),10);
  assert.equal(await page.locator('[data-record="1"]').inputValue(),'0.5');
  for(const count of [15,20,25,30,31]){
    await page.locator('#showMoreWork').click();
    assert.equal(await rows.count(),count);
  }
  assert.equal(await page.locator('#showMoreWork').isVisible(),false);
  await page.locator('[data-record="31"]').selectOption('0.5');
  assert.match(await page.locator('#compTotals').textContent(),/割当 1日/);
  const dateBox=await page.locator('#compDates').boundingBox();
  const addBox=await page.locator('#addCompDate').boundingBox();
  assert.ok(addBox.y>=dateBox.y+dateBox.height);
  await page.locator('.comp-date').fill('2026-09-10');
  await page.locator('#addCompDate').click();
  assert.equal(await page.locator('.date-row').count(),2);
  await page.locator('.date-row').last().locator('button').click();
  assert.equal(await page.locator('.date-row').count(),1);
  assert.match(await page.locator('#compTotals').textContent(),/代休日数 1日 ／ 割当 1日/);
  for(const width of [320,375,390,520,820]){
    await page.setViewportSize({width,height:900});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`overflow ${width}`);
    assert.equal(await page.locator('.allocation-info small').first().evaluate(el=>getComputedStyle(el).whiteSpace),'normal');
  }
  await page.setViewportSize({width:375,height:812});
  if(process.env.UI_SCREENSHOT)await page.screenshot({path:process.env.UI_SCREENSHOT,fullPage:false});
  await page.locator('#compForm .primary').click();
  await page.waitForFunction(()=>window.writes.some(x=>x.p==='submit_application'));
  const allocations=await page.evaluate(()=>window.writes.find(x=>x.p==='comp_leave_allocations').body);
  assert.deepEqual(allocations.map(x=>[x.holiday_work_record_id,x.allocated_days]),[[1,.5],[31,.5]]);
  assert.equal(await rows.count(),5);
  await page.locator('[data-panel="history"]').click();
  assert.ok((await page.locator('#applicationHistory').textContent()).includes('事由：'+reason));
  assert.equal(await page.locator('#applicationHistory script').count(),0);
  await page.locator('[data-edit-revision]').click();
  await page.waitForFunction(()=>document.querySelector('[data-record="26"]').value==='1');
  assert.equal(await rows.count(),30);
  assert.equal(await page.locator('[data-record="26"]').isVisible(),true);
  assert.equal(await page.locator('#compNote').inputValue(),reason);
  await page.goto('http://local.test/application-print.html?application_id=10');
  await page.locator('#printSheet').waitFor({state:'visible'});
  assert.equal(await page.locator('.comp-form').count(),2);
  for(const copy of await page.locator('.comp-form').all()){
    assert.ok((await copy.textContent()).includes(reason));
    assert.equal(await copy.locator('th', {hasText:'事由'}).count(),1);
    assert.equal(await copy.locator('script').count(),0);
  }
  await page.setViewportSize({width:1123,height:794});
  await page.emulateMedia({media:'print'});
  assert.equal(await page.locator('.print-copy').evaluateAll(copies=>copies.every(el=>el.scrollHeight<=el.clientHeight)),true);
  assert.equal(errors.length,0,errors.join('\n'));
  console.log('PASS: oldest-first 5/10/15/20/25/30/31, preserved allocation payload, revision visibility, reason escaping/history/print, date controls, mobile widths');
} finally { await browser.close(); }
