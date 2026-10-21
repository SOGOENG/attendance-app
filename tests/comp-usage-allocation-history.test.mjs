// PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node tests/comp-usage-allocation-history.test.mjs
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const read=f=>readFile(new URL(`../${f}`,import.meta.url),'utf8');
const script=await read('applications-admin.js');
const start=script.indexOf('async function renderCompUsageHistory(');
const renderer=script.slice(start,script.indexOf('\nfunction editWork(',start+1));
const browser=await chromium.launch({channel:'msedge',headless:true});
try {
  const page=await browser.newPage();
  await page.setContent((await read('applications-admin.html')).replace(/<script\b[^>]*>[\s\S]*?<\/script>/g,'').replace(/<link\b[^>]*>/g,''));
  for(const file of ['style.css','applications.css','work-history.css'])await page.addStyleTag({content:await read(file)});
  await page.evaluate(()=>{
    window.$=id=>document.getElementById(id);
    window.esc=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
    window.dt=s=>s?String(s).slice(0,10).replaceAll('-','/'):'-';
    $('workPanel').hidden=false;
    $('workEmployee').innerHTML='<option value="7" selected>Employee</option>';
    document.querySelectorAll('#workPanel details').forEach(el=>el.open=true);
    window.requests=[];
    window.req=async path=>{
      requests.push(path);
      if(path.startsWith('comp_leave_date_allocations?'))return window.saved || [];
      if(path.startsWith('comp_leave_dates?'))return window.dates;
      if(path.startsWith('comp_leave_allocations?'))return window.allocations;
      return [{id:80,work_date:'2026-06-13'},{id:10,work_date:'2026-06-06'}];
    };
    window.apps=[{id:4,submitted_at:'2026-10-17T01:00:00Z',approved_at:'2026-10-18T01:00:00Z'}];
  });
  await page.addScriptTag({content:renderer});
  const render=async(dates,allocations)=>page.evaluate(async({dates,allocations})=>{
    window.dates=dates.map((row,index)=>({application_id:4,id:index+1,...row}));
    window.allocations=allocations.map(row=>({application_id:4,...row}));
    await renderCompUsageHistory(7,apps);
  },{dates,allocations});
  const d=(leave_date,days=1)=>({leave_date,days});
  const a=(id,holiday_work_record_id,allocated_days=1)=>({id,holiday_work_record_id,allocated_days});
  const card=page.locator('#compUsageList article');
  await render([d('2026-10-01')],[a(99,80)]);
  assert.match(await card.innerText(),/2026\/10\/01/);assert.match(await card.innerText(),/2026\/06\/13/);
  assert.doesNotMatch(await card.innerText(),/2026\/06\/06/);
  assert.equal(await card.locator('.comp-usage-pair').count(),1);
  assert.match(await card.innerText(),/申請日：2026\/10\/17\n承認日：2026\/10\/18/);
  assert.equal((await card.innerText()).match(/申請日/g).length,1);
  await render([d('2026-10-01')],[a(90,80,.5),a(12,10,.5)]);
  assert.equal(await card.locator('.comp-usage-pair').count(),2);
  for(const row of await card.locator('.comp-usage-pair').all())assert.match(await row.innerText(),/0.5日割当/);
  await render([d('2026-10-08',.5),d('2026-10-01',.5)],[a(70,80)]);
  assert.equal(await card.locator('.comp-usage-pair').count(),2);
  // Reversed order, unrelated IDs: multiple dates/sources must never be zipped.
  await render([d('2026-10-08'),d('2026-10-01')],[a(99,80,.5),a(3,10,1.5)]);
  assert.equal(await card.locator('.comp-usage-pair').count(),0);
  assert.match(await card.innerText(),/日別の対応は確定できません/);
  assert.match(await card.innerText(),/2026\/06\/13（0.5日割当）/);
  assert.match(await card.innerText(),/2026\/06\/06（1.5日割当）/);
  for(const width of [1280,320]){
    await page.setViewportSize({width,height:900});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    const sections=await card.locator('.comp-usage-groups section').all();
    const boxes=await Promise.all(sections.map(el=>el.boundingBox()));
    if(width===320)assert.ok(boxes[1].y>=boxes[0].y+boxes[0].height);
    else assert.equal(boxes[0].y,boxes[1].y);
    await render([d('2026-10-01')],[a(90,80,.5),a(12,10,.5)]);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    await render([d('2026-10-08'),d('2026-10-01')],[a(99,80,.5),a(3,10,1.5)]);
  }
  // Saved edges intentionally differ from date/source order. UI must use the IDs.
  await page.evaluate(()=>{window.saved=[
    {application_id:4,comp_leave_date_id:1,comp_leave_allocation_id:3,holiday_work_record_id:10,allocated_days:1},
    {application_id:4,comp_leave_date_id:2,comp_leave_allocation_id:99,holiday_work_record_id:80,allocated_days:1}
  ];});
  await render([d('2026-10-08'),d('2026-10-01')],[a(99,80),a(3,10)]);
  assert.equal(await card.locator('.comp-usage-pair').count(),2);
  assert.match(await card.locator('[data-allocation-id="3"]').innerText(),/2026\/10\/08[\s\S]*2026\/06\/06/);
  assert.match(await card.locator('[data-allocation-id="99"]').innerText(),/2026\/10\/01[\s\S]*2026\/06\/13/);
  for(const width of [1280,320]){
    await page.setViewportSize({width,height:900});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  }
  await page.evaluate(()=>{window.saved[0].allocated_days=.5;});
  await render([d('2026-10-08'),d('2026-10-01')],[a(99,80),a(3,10)]);
  assert.equal(await card.locator('.comp-usage-pair').count(),0);
  assert.match(await card.innerText(),/保存済みの日別割当/);
  await page.evaluate(()=>{window.saved=[];});
  await render([d('2026-10-01')],[a(1,999)]);assert.match(await card.innerText(),/日付不明/);
  await render([d('2026-10-01')],[a(1,80,.5)]);assert.equal(await card.locator('.comp-usage-pair').count(),0);
  assert.match(await card.innerText(),/一致していません/);
  await page.evaluate(async()=>{apps[0].submitted_at=null;apps[0].approved_at=null;await renderCompUsageHistory(7,apps);});
  assert.match(await card.innerText(),/申請日：-\n承認日：-/);
  await page.evaluate(async()=>{await renderCompUsageHistory(7,[]);});assert.match(await page.locator('#compUsageList').innerText(),/ありません/);
  console.log('PASS: real allocation IDs, single/multiple dates and sources, fractional allocations, ambiguous mapping never guessed, dates, missing data, 1280px/320px layouts');
} finally {await browser.close();}
