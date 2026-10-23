// Local files and mocked APIs only; production traffic is blocked.
import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { pathToFileURL, fileURLToPath } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const fixture = JSON.parse(execFileSync('python', ['-c', "import runpy,json; print(json.dumps(runpy.run_path('tests/driving-report-csv-ui.test.py')['fixture']('2026-09')))"]).toString());
fixture.employees[1].department = '技術部';
fixture.employees[1].name = '検証 社員乙';
fixture.employees.push({ id: 3, name: '未設定社員', department: '', active: true }, { id: 4, name: '長い氏名の社員テスト 名前', department: '工事部', active: true });
fixture.employees[2].name = '長い氏名の社員テスト 名前';
const server = createServer(async (req, res) => {
  const file = new URL(req.url, 'http://localhost').pathname.slice(1);
  if (!/^[a-z0-9.-]+$/i.test(file)) { res.writeHead(404); return res.end(); }
  try {
    res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html; charset=utf-8');
    res.end(await readFile(new URL('../' + file, import.meta.url)));
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_PATH });
try {
  const page = await browser.newPage();
  await page.clock.install({ time: new Date('2026-10-10T12:00:00+09:00') });
  const errors = [];
  let sourceFailure=false, statusFailure=false, empty=false, admin=true;
  page.on('pageerror', e => errors.push(e.message));
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/portal-auth.js') return route.fulfill({ contentType: 'text/javascript', body: 'const PORTAL_SUPABASE_URL="https://mock.invalid";window.portalFetch=(u,o)=>fetch(u,o);' });
    if (url.hostname === 'mock.invalid') {
      if(route.request().method()==='GET'){
        assert(admin);
        if(statusFailure)return route.fulfill({status:503,json:{}});
        const month=url.searchParams.get('closing_month')?.slice(3,10)||'2026-09';
        let rows;
        if(url.pathname.endsWith('/employees'))rows=empty?[]:fixture.employees.map((e,i)=>({...e,driving_report_required:i<3}));
        else {assert(url.pathname.endsWith('/driving_report_month_submissions'));rows=[{employee_id:1,closing_month:month+'-01'}];}
        return route.fulfill({json:rows,headers:{'Access-Control-Expose-Headers':'Content-Range','Content-Range':rows.length?`0-${rows.length-1}/${rows.length}`:'*/0'}});
      }
      assert.equal(route.request().method(), 'POST');
      if (url.pathname.endsWith('/is_application_admin')) return route.fulfill({ json: admin });
      assert(admin, 'privileged RPC called after authorization denial');
      const body=route.request().postDataJSON(),month=body.p_closing_month?.slice(0,7);
      if(url.pathname.endsWith('/admin_driving_month_status')||url.pathname.endsWith('/admin_driving_month_days')){
        if(statusFailure)return route.fulfill({status:503,json:{}});
        const span=await page.evaluate(m=>DrivingReportPeriod.range(m),month);
        const envelope={closing_month:month+'-01',period_start:span.start,period_end:span.end};
        if(url.pathname.endsWith('/admin_driving_month_status'))return route.fulfill({json:{...envelope,actor_id:1,roster_token:'a'.repeat(32),total:empty?0:3,employees:empty?[]:fixture.employees.slice(0,3).map((e,i)=>({...e,submitted:i===0,submitted_at:null,missing:1,incomplete:0,review:i===2?1:0}))}});
        return route.fulfill({json:{...envelope,employee:{id:body.p_employee_id,name:'検証社員',department:'工事部',driving_report_required:true},submitted:false,submitted_at:null,days:span.days.map((date,i)=>({date,status:i===0?'draft':null,kind:i===0?'ready':i===1?'missing':i===2?'exempt':'review',reason:i===2?'company_holiday':null}))}});
      }
      assert(url.pathname.endsWith('/admin_driving_report_csv_source'));
      if(sourceFailure)return route.fulfill({status:503,json:{message:'unavailable'}});
      return route.fulfill({ json: fixture });
    }
    assert.equal(url.hostname, '127.0.0.1');
    return route.continue();
  });
  await page.goto(`http://127.0.0.1:${server.address().port}/driving-report-csv-admin.html`);
  await page.waitForFunction(() => !document.getElementById('csvContent').hidden);
  await page.waitForFunction(()=>document.querySelectorAll('.csv-employee').length===4);
  assert.deepEqual(await page.locator('.csv-department h3').allTextContents(), ['技術部（0 / 1人）', '工事部（1 / 2人）', '所属未設定（0 / 1人）']);
  assert.equal(await page.locator('.csv-department').nth(1).locator('.csv-employee').count(), 2, 'target OFF employee included');
  assert.equal(await page.locator('#csvRoster input,#selectAll,#clearSelection').count(),0);
  assert.equal(await page.locator('.csv-employee-status.is-submitted').innerText(),'提出済み');
  assert.equal(await page.locator('.csv-employee-status.is-missing').count(),3);
  assert((await page.locator('#csvSummary').innerText()).includes('月別提出済み 1人'));
  assert.deepEqual(await page.locator('.csv-employee-status.is-missing').allTextContents(),['未提出','未提出','未提出']);
  assert(await page.locator('#downloadCsvZip').isDisabled());
  await page.locator('#confirmRoster').check();
  assert(!(await page.locator('#downloadCsvZip').isDisabled()));
  await mkdir(new URL('../tmp/driving-csv-all-roster/', import.meta.url), { recursive: true });
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `page overflow ${width}`);
    assert(await page.locator('.csv-employee').evaluateAll(nodes => nodes.every(n => {
      const name = n.querySelector('.employee-status-name');
      const status=n.querySelector('.csv-employee-status'),badge=status.getBoundingClientRect(),textBox=n.querySelector('.csv-employee-text').getBoundingClientRect();
      const meta=n.querySelector('.csv-employee-meta').getBoundingClientRect(),nameBox=name.getBoundingClientRect();
      return name.scrollWidth<=name.clientWidth && name.scrollHeight<=name.clientHeight && getComputedStyle(name).whiteSpace === 'normal' && meta.top>=nameBox.bottom && n.getBoundingClientRect().height >= 44 && badge.left>=textBox.right && badge.right<=n.getBoundingClientRect().right && getComputedStyle(status).whiteSpace==='nowrap' && Math.abs(n.getBoundingClientRect().width-n.parentElement.getBoundingClientRect().width)<1;
    })), `name/status layout ${width}`);
    await page.screenshot({ path: fileURLToPath(new URL(`../tmp/driving-csv-all-roster/${width}.png`, import.meta.url)), fullPage: true });
  }
  assert.equal(await page.locator('.is-submitted.csv-employee-status').evaluate(n=>getComputedStyle(n).color),'rgb(22, 101, 52)');
  assert.equal(await page.locator('.is-missing.csv-employee-status').first().evaluate(n=>getComputedStyle(n).color),'rgb(185, 28, 28)');
  // Compare the actual attendance header's shared CSS in both themes.
  const reference=await browser.newPage();
  await reference.route('**/*',route=>{
    const url=new URL(route.request().url());
    assert.equal(url.hostname,'127.0.0.1');
    if(url.pathname.endsWith('.js'))return route.fulfill({contentType:'text/javascript',body:''});
    return route.continue();
  });
  await reference.goto(`http://127.0.0.1:${server.address().port}/attendance-admin.html`);
  const styles=async target=>target.evaluate(()=>{
    const properties=['backgroundColor','color','padding','margin','borderRadius','fontSize','fontWeight','lineHeight','textDecorationLine','display','flexDirection','gap'];
    return ['.admin-home-header','.admin-home-header-text h1','.admin-home-portal-title','.admin-home-header-text p','.admin-home-back-button'].map(selector=>{
      const style=getComputedStyle(document.querySelector(selector));
      return Object.fromEntries(properties.map(key=>[key,style[key]]));
    });
  });
  for(const theme of ['light','dark'])for(const width of [1440,768,390,320]){
    for(const target of [page,reference]){
      await target.setViewportSize({width,height:1000});
      await target.evaluate(theme=>document.documentElement.dataset.portalTheme=theme,theme);
    }
    assert.deepEqual(await styles(page),await styles(reference),`attendance header match: ${theme}/${width}`);
    assert.equal(await page.locator('.admin-home-back-button').getAttribute('href'),'admin.html');
    assert(await page.locator('.admin-home-header').evaluate(n=>n.scrollWidth<=n.clientWidth));
    assert(await page.locator('.admin-home-back-button').evaluate(n=>n.scrollWidth<=n.clientWidth));
    assert(await page.locator('.csv-employee').evaluateAll(cards=>cards.every(card=>{
      const luminance=value=>{const rgb=value.match(/\d+/g).slice(0,3).map(Number).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;});return rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722;};
      const background=luminance(getComputedStyle(card).backgroundColor);
      return ['.employee-status-name','.csv-employee-meta','.csv-employee-status'].every(selector=>{
        const foreground=luminance(getComputedStyle(card.querySelector(selector)).color);
        return (Math.max(background,foreground)+.05)/(Math.min(background,foreground)+.05)>=4.5;
      });
    })),`readable card text ${theme}/${width}`);
    await page.locator('.admin-home-header').screenshot({path:fileURLToPath(new URL(`../tmp/driving-csv-all-roster/header-${theme}-${width}.png`,import.meta.url))});
    await page.screenshot({path:fileURLToPath(new URL(`../tmp/driving-csv-all-roster/${theme}-${width}.png`,import.meta.url)),fullPage:true});
  }
  await reference.close();
  console.log('PASS header: actual attendance shared styles match, light/dark at 1440/768/390/320, unchanged back destination, no header overflow.');
  sourceFailure=true;
  await page.locator('#reloadCsv').click();
  await page.waitForFunction(()=>document.getElementById('csvMessage').textContent.includes('未確認'));
  assert(await page.locator('#downloadCsvZip').isDisabled());
  assert(await page.locator('#confirmRoster').isDisabled());
  // Status RPC remains usable when export source is unavailable.
  await page.waitForFunction(()=>document.querySelectorAll('.csv-employee').length===4);
  sourceFailure=false;
  await page.locator('#reloadCsv').click();
  await page.waitForFunction(()=>document.querySelectorAll('.csv-employee-status.is-submitted').length===1);
  assert.equal(await page.locator('.csv-employee-status.is-missing').count(),3);
  await page.locator('#statusEmployees .employee-status-name').first().click();
  await page.waitForFunction(()=>document.getElementById('statusDays').children.length>0);
  assert(await page.locator('#statusList').isHidden());
  const days=await page.locator('#statusDays').innerText();
  for(const text of ['下書き','未入力','会社休日','要確認'])assert(days.includes(text), text);
  for(const width of [1440,768,390,320]){
    await page.setViewportSize({width,height:1000});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await page.screenshot({path:fileURLToPath(new URL(`../tmp/driving-csv-all-roster/detail-${width}.png`,import.meta.url)),fullPage:true});
  }
  await page.locator('#backToStatusList').click();assert(await page.locator('#statusDetail').isHidden());
  empty=true;await page.locator('#reloadCsv').click();await page.waitForFunction(()=>document.getElementById('statusMessage').textContent.includes('社員は0人'));
  assert.equal(await page.locator('.csv-employee').count(),0);
  assert((await page.locator('#csvSummary').innerText()).includes('月別提出済み 1人'),'CSV includes submitted employees even when target list empty');
  empty=false;statusFailure=true;await page.locator('#reloadCsv').click();await page.waitForFunction(()=>document.getElementById('statusMessage').textContent.includes('取得できません'));
  assert.equal(await page.locator('.csv-employee').count(),0);
  statusFailure=false;
  assert.deepEqual(errors, []);
  let downloads=0;
  page.on('download',()=>downloads++);
  page.once('dialog',async dialog=>{
    assert(dialog.message().includes('提出済み分のみ出力'));
    await dialog.dismiss();
  });
  await page.locator('#confirmRoster').check();
  await page.locator('#downloadCsvZip').click();
  await page.waitForFunction(()=>document.getElementById('csvMessage').textContent.includes('出力を取り消しました'));
  assert.equal(downloads,0);
  sourceFailure=true;
  await page.locator('#downloadCsvZip').click();
  await page.waitForFunction(()=>document.getElementById('csvMessage').textContent.includes('未確認'));
  assert(await page.locator('#downloadCsvZip').isDisabled());
  assert.equal(downloads,0);
  await page.locator('#closingMonth').fill('2027-01');await page.locator('#closingMonth').dispatchEvent('change');
  await page.waitForFunction(()=>document.getElementById('statusPeriod').textContent.includes('2026-12-21〜2027-01-20'));
  admin=false;await page.reload();await page.waitForFunction(()=>document.getElementById('statusMessage').textContent.includes('全体管理者のみ'));
  assert.equal(await page.locator('.csv-employee').count(),0);assert(await page.locator('#downloadCsvZip').isDisabled());
  assert.deepEqual(errors, []);
  console.log('PASS integrated status: all employees, target OFF labels, departments, submitted/missing, day details/drafts/holidays/back, empty roster, errors, year rollover, admin denial; unchanged CSV confirmation and fail-closed export; PC/iPad/iPhone/320.');
} finally { await browser.close(); await new Promise(r => server.close(r)); }
