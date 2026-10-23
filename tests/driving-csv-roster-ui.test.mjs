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
  let sourceFailure=false;
  page.on('pageerror', e => errors.push(e.message));
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/portal-auth.js') return route.fulfill({ contentType: 'text/javascript', body: 'const PORTAL_SUPABASE_URL="https://mock.invalid";window.portalFetch=(u,o)=>fetch(u,o);' });
    if (url.hostname === 'mock.invalid') {
      assert.equal(route.request().method(), 'POST');
      if (url.pathname.endsWith('/is_application_admin')) return route.fulfill({ json: true });
      assert(url.pathname.endsWith('/admin_driving_report_csv_source'));
      if(sourceFailure)return route.fulfill({status:503,json:{message:'unavailable'}});
      return route.fulfill({ json: fixture });
    }
    assert.equal(url.hostname, '127.0.0.1');
    return route.continue();
  });
  await page.goto(`http://127.0.0.1:${server.address().port}/driving-report-csv-admin.html`);
  await page.waitForFunction(() => !document.getElementById('csvContent').hidden);
  assert.deepEqual(await page.locator('.csv-department h3').allTextContents(), ['工事部', '技術部', '所属未設定']);
  assert.equal(await page.locator('.csv-department').first().locator('.csv-employee').count(), 2, 'noncontiguous department grouped');
  assert.equal(await page.locator('#csvRoster input,#selectAll,#clearSelection').count(),0);
  assert.equal(await page.locator('.csv-employee-status.is-submitted').innerText(),'提出済み');
  assert.equal(await page.locator('.csv-employee-status.is-missing').count(),3);
  assert((await page.locator('#csvSummary').innerText()).includes('一覧人数 4人 ／ 提出済み 1人 ／ 提出記録なし 3人'));
  assert.deepEqual(await page.locator('.csv-employee-status.is-missing').allTextContents(),['提出記録なし','提出記録なし','提出記録なし']);
  assert(await page.locator('#downloadCsvZip').isDisabled());
  await page.locator('#confirmRoster').check();
  assert(!(await page.locator('#downloadCsvZip').isDisabled()));
  await mkdir(new URL('../tmp/driving-csv-roster/', import.meta.url), { recursive: true });
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `page overflow ${width}`);
    assert(await page.locator('.csv-employee').evaluateAll(nodes => nodes.every(n => {
      const name = n.querySelector('.employee-status-name');
      const status=n.querySelector('.csv-employee-status'),badge=status.getBoundingClientRect(),textBox=n.querySelector('.csv-employee-text').getBoundingClientRect();
      const meta=n.querySelector('.csv-employee-meta').getBoundingClientRect(),nameBox=name.getBoundingClientRect();
      return name.scrollWidth<=name.clientWidth && name.scrollHeight<=name.clientHeight && getComputedStyle(name).whiteSpace === 'normal' && meta.top>=nameBox.bottom && n.getBoundingClientRect().height >= 44 && badge.left>=textBox.right && badge.right<=n.getBoundingClientRect().right && getComputedStyle(status).whiteSpace==='nowrap' && Math.abs(n.getBoundingClientRect().width-n.parentElement.getBoundingClientRect().width)<1;
    })), `name/status layout ${width}`);
    await page.screenshot({ path: fileURLToPath(new URL(`../tmp/driving-csv-roster/${width}.png`, import.meta.url)), fullPage: true });
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
    await page.locator('.admin-home-header').screenshot({path:fileURLToPath(new URL(`../tmp/driving-csv-roster/header-${theme}-${width}.png`,import.meta.url))});
  }
  await reference.close();
  console.log('PASS header: actual attendance shared styles match, light/dark at 1440/768/390/320, unchanged back destination, no header overflow.');
  sourceFailure=true;
  await page.locator('#reloadCsv').click();
  await page.waitForFunction(()=>document.getElementById('csvMessage').textContent.includes('未確認'));
  assert.equal(await page.locator('.csv-employee-status.is-unconfirmed').count(),4);
  assert.equal(await page.locator('.csv-employee-status.is-submitted,.csv-employee-status.is-missing').count(),0);
  assert(await page.locator('#downloadCsvZip').isDisabled());
  assert(await page.locator('#confirmRoster').isDisabled());
  assert((await page.locator('#csvSummary').innerText()).includes('人数は未確認'));
  sourceFailure=false;
  await page.locator('#reloadCsv').click();
  await page.waitForFunction(()=>document.querySelectorAll('.csv-employee-status.is-submitted').length===1);
  assert.equal(await page.locator('.csv-employee-status.is-missing').count(),3);
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
  console.log('PASS read-only roster: departments, no employee checkboxes/bulk controls, counts and monthly labels, output confirmation, failure blocks export, recovery; PC/iPad/iPhone/320; no JS errors.');
} finally { await browser.close(); await new Promise(r => server.close(r)); }
