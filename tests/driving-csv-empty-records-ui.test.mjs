// Local browser and mocked read-only RPCs. Never contacts production.
import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { pathToFileURL, fileURLToPath } from 'node:url';
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const fixture = JSON.parse(execFileSync('python', ['-c', "import runpy,json; print(json.dumps(runpy.run_path('tests/driving-report-csv-ui.test.py')['fixture']('2026-10')))"]).toString());
// Retain the old error handler as a cache-mismatch fixture, independent of Git HEAD.
const currentScript = await readFile(new URL('../driving-report-csv-admin.js', import.meta.url), 'utf8');
const oldScript = currentScript.replace(/function unconfirmedRoster\(\)\{[\s\S]*?\n  \}/, `function unconfirmedRoster(){
    result=null;$('confirmRoster').checked=false;
    for(const status of $('csvRoster').querySelectorAll('.csv-employee-status')){
      status.textContent='未確認';
    }
  }`);
assert.notEqual(oldScript, currentScript, 'legacy error handler fixture installed');
const server = createServer(async (req, res) => {
  const file = new URL(req.url, 'http://localhost').pathname.slice(1);
  if (!/^[a-z0-9.-]+$/i.test(file)) { res.writeHead(404); return res.end(); }
  try {
    res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html; charset=utf-8');
    res.end(await readFile(new URL('../' + file, import.meta.url)));
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_PATH });
  const page = await browser.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.clock.install({ time: new Date('2026-11-02T12:00:00+09:00') });
  let legacy = true, targets = 2, employeeCount = 2, submitted = 0, failure = false, missingCount = false;
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/portal-auth.js') return route.fulfill({ contentType: 'text/javascript', body: 'const PORTAL_SUPABASE_URL="https://mock.invalid";window.portalFetch=(u,o)=>fetch(u,o);' });
    if (legacy && url.pathname === '/driving-report-csv-admin.js') return route.fulfill({ contentType: 'text/javascript', body: oldScript });
    if (url.hostname === 'mock.invalid') {
      if(route.request().method()==='GET'){
        if(failure||legacy)return route.fulfill({status:503,json:{}});
        let rows;
        if(url.pathname.endsWith('/employees'))rows=fixture.employees.slice(0,employeeCount).map((e,i)=>({...e,department:i?'技術部':'工事部',driving_report_required:i<targets}));
        else {assert(url.pathname.endsWith('/driving_report_month_submissions'));assert.equal(url.searchParams.get('closing_month'),'eq.2026-10-01');rows=fixture.employees.slice(0,submitted).map(e=>({employee_id:e.id,closing_month:'2026-10-01'}));}
        const total=rows.length,offset=Number(url.searchParams.get('offset'));
        rows=rows.slice(offset,offset+1); // Exercise a server page cap below the requested limit.
        return route.fulfill({json:rows,headers:missingCount?{}:{'Access-Control-Expose-Headers':'Content-Range','Content-Range':total?`${offset}-${offset+rows.length-1}/${total}`:'*/0'}});
      }
      assert.equal(route.request().method(), 'POST');
      const name = url.pathname.split('/').at(-1);
      if (name === 'is_application_admin') return route.fulfill({ json: true });
      if (failure || legacy) return route.fulfill({ status: 503, json: { message: 'unavailable' } });
      const body = route.request().postDataJSON();
      assert.equal(body.p_closing_month, '2026-10-01');
      if (name === 'admin_driving_report_csv_source') {
        const source = structuredClone(fixture);
        source.submissions = Array.from({ length: submitted }, (_, i) => ({ ...structuredClone(fixture.submissions[0]), id: i + 1, employee_id: i + 1, submitted_by: i + 1 }));
        return route.fulfill({ json: source });
      }
      const span = await page.evaluate(() => DrivingReportPeriod.range('2026-10'));
      const envelope = { closing_month: '2026-10-01', period_start: span.start, period_end: span.end };
      if (name === 'admin_driving_month_status') return route.fulfill({ json: {
        ...envelope, actor_id: 1, roster_token: 'a'.repeat(32), total: targets,
        employees: fixture.employees.slice(0, targets).map((e, i) => ({ ...e, department: i ? '技術部' : '工事部', submitted: i < submitted, submitted_at: null, missing: i < submitted ? 0 : 1, incomplete: 0, review: 0 }))
      } });
      assert.equal(name, 'admin_driving_month_days');
      const isSubmitted = body.p_employee_id <= submitted;
      return route.fulfill({ json: { ...envelope, employee: { id: body.p_employee_id, name: '検証社員', department: '工事部', driving_report_required: body.p_employee_id<=targets }, submitted: isSubmitted, submitted_at: null,
        days: span.days.map((date, i) => ({ date, kind: isSubmitted ? 'complete' : i === 0 ? 'missing' : 'exempt', status: null, reason: 'company_holiday' })) } });
    }
    assert.equal(url.hostname, '127.0.0.1', 'unexpected external traffic');
    return route.continue();
  });
  const url = `http://127.0.0.1:${server.address().port}/driving-report-csv-admin.html`;
  // Reproduce the reported null reference with the pre-integration JS and new HTML.
  await page.goto(url);
  await page.waitForFunction(() => document.getElementById('csvMessage').textContent.includes('querySelectorAll'));
  console.log('PASS reproduction: old JS + integrated HTML produces null.querySelectorAll on source failure');
  legacy = false;
  const screenshotDir = new URL('../tmp/driving-csv-all-employees/', import.meta.url);
  await mkdir(screenshotDir, { recursive: true });
  for (const scenario of [{ name: 'zero-employees', employees: 0, targets: 0, submitted: 0 }, { name: 'zero-targets', targets: 0, submitted: 0 }, { name: 'zero-submissions', targets: 2, submitted: 0 }, { name: 'partial', targets: 2, submitted: 1 }, { name: 'all-submitted', targets: 2, submitted: 2 }]) {
    ({ targets, submitted } = scenario); employeeCount=scenario.employees??2;
    await page.goto(url);
    await page.locator('#closingMonth').fill('2026-10');
    await page.locator('#closingMonth').dispatchEvent('change');
    await page.locator('#reloadCsv').click();
    await page.waitForFunction(count => !document.getElementById('csvContent').hidden && document.querySelectorAll('.csv-employee').length === count && !document.getElementById('reloadCsv').disabled, employeeCount);
    assert.equal(await page.locator('.csv-employee-status.is-submitted').count(), Math.min(employeeCount, submitted));
    assert.equal(await page.locator('.csv-employee-status.is-missing').count(), employeeCount - Math.min(employeeCount, submitted));
    if (!employeeCount) assert((await page.locator('#statusMessage').innerText()).includes('社員は0人'));
    else assert((await page.locator('#statusMessage').innerText()).includes(`${submitted} / ${employeeCount}人`));
    if(!targets&&employeeCount)assert.equal(await page.getByText('対象外（提出義務なし）',{exact:false}).count(),employeeCount);
    for(const heading of await page.locator('.csv-department h3').allTextContents())assert(/（[01] \/ 1人）/.test(heading),heading);
    if (!submitted) { assert((await page.locator('#csvMessage').innerText()).includes('月別提出記録はありません')); assert(await page.locator('#downloadCsvZip').isDisabled()); }
    for (const width of [1440, 768, 390, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await page.screenshot({ path: fileURLToPath(new URL(`${scenario.name}-${width}.png`, screenshotDir)), fullPage: true });
      if (employeeCount) {
        await page.locator('#statusEmployees .employee-status-name').first().click();
        await page.waitForFunction(() => document.getElementById('statusDays').children.length === DrivingReportPeriod.range('2026-10').days.length);
        assert(await page.locator('#statusList').isHidden());
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
        await page.locator('#backToStatusList').click();
        assert(await page.locator('#statusDetail').isHidden());
      }
    }
    console.log(`PASS ${scenario.name}: October select/reload, 4 widths, daily/back where applicable`);
  }
  missingCount=true;await page.locator('#reloadCsv').click();
  await page.waitForFunction(()=>document.getElementById('statusMessage').textContent.includes('全件取得を確認できません'));
  assert.equal(await page.locator('.csv-employee').count(),0,'incomplete read must not imply unsubmitted');
  missingCount=false;
  failure = true;
  await page.locator('#reloadCsv').click();
  await page.waitForFunction(() => document.getElementById('csvMessage').textContent.includes('未確認') && document.getElementById('statusMessage').textContent.includes('取得できません'));
  assert(await page.locator('#downloadCsvZip').isDisabled());
  assert.equal(await page.locator('.csv-employee').count(), 0);
  assert.deepEqual(errors, []);
  console.log('PASS source/status failure: no stale rows, export disabled, no JavaScript errors');
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
