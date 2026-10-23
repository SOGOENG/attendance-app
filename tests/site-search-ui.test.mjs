// Local server + mocked Supabase only. No production network access.
// PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs BROWSER_CHANNEL=msedge node tests/site-search-ui.test.mjs
import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join } from 'node:path';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const root = fileURLToPath(new URL('../', import.meta.url));
const server = createServer(async (req, res) => {
  const file = new URL(req.url, 'http://localhost').pathname.slice(1);
  if (!/^[a-z0-9.-]+$/i.test(file)) { res.writeHead(404); res.end(); return; }
  try {
    const body = await readFile(join(root, file));
    res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html; charset=utf-8');
    res.end(body);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ headless: true, channel: process.env.BROWSER_CHANNEL || 'msedge' });
const base = `http://127.0.0.1:${server.address().port}`;
const fixtures = Array.from({ length: 1003 }, (_, i) => ({ id: i + 1, display_name: `現場${i + 1}`, official_name: `正式名称${i + 1}`, construction_no: `K-${i + 1}`, visible: true }));
fixtures[0] = { id: 1, display_name: '中央病院', official_name: '中央医療センター改修', construction_no: 'BUILD-987', input_code: 'INPUT-WRONG', visible: true };
fixtures[1] = { id: 2, display_name: '<img src=x onerror=alert(1)>', official_name: '安全表示確認', construction_no: '<b>工事番号</b>', visible: true };
fixtures.push({ id: 2000, display_name: '旧庁舎', official_name: '旧合同庁舎改修', construction_no: 'HIDDEN-99', visible: false });
try {
  for (const role of ['none', 'all']) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });
    await context.addInitScript(scope => {
      localStorage.setItem('portalLoginUser', JSON.stringify({ id: 1, name: 'テスト社員', department: '工事部', adminScope: scope }));
      localStorage.setItem('portalAuthSession', JSON.stringify({ accessToken: 'local-test', expiresAt: Date.now() + 3600000 }));
    }, role);
    const calls = [], blocked = [], errors = [];
    let failure = false, networkFailure = false, delay = false;
    await context.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url());
      if (url.origin === base) { await route.continue(); return; }
      if (url.hostname !== 'fgmvmbjnoyagnpygcbky.supabase.co') { blocked.push(request.url()); await route.abort(); return; }
      calls.push({ method: request.method(), path: url.pathname, params: Object.fromEntries(url.searchParams) });
      assert.equal(request.method(), 'GET', 'all data requests must be GET');
      if (!url.pathname.endsWith('/sites')) { await route.fulfill({ json: [] }); return; }
      if (delay) await new Promise(resolve => setTimeout(resolve, 150));
      if (networkFailure) { await route.abort(); return; }
      if (failure) { await route.fulfill({ status: 403, json: { message: 'denied' } }); return; }
      assert.equal(url.searchParams.get('select'), 'id,display_name,official_name,construction_no,visible');
      assert.equal(url.searchParams.get('order'), 'id.asc');
      const rows = fixtures.filter(s => url.searchParams.get('visible') === 'eq.true' ? s.visible : true);
      // Deliberately lower than requested 500: exercise a real server row cap.
      const offset = Number(url.searchParams.get('offset'));
      await route.fulfill({ json: rows.slice(offset, offset + 137) });
    });
    const page = await context.newPage();
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(`${base}/site-search.html`);
    const status = page.locator('#siteSearchStatus'), input = page.locator('#siteSearchInput'), select = page.locator('#siteSearchSelect');
    const count = async text => { await page.waitForFunction(value => document.getElementById('siteSearchStatus').textContent === value, text); };
    await count('1003件');
    assert.equal(await select.locator('option').count(), 1004);
    assert.ok(calls.some(c => c.params.offset === '1003'), 'must read empty final page');
    await input.fill('央病'); await count('1件');
    assert.deepEqual(await page.locator('tbody td').allTextContents(), ['中央病院', 'BUILD-987']);
    assert.doesNotMatch(await page.locator('#siteSearchResults').innerText(), /INPUT-WRONG|中央医療/);
    await input.fill('医療センター'); await count('1件');
    await input.fill('現場1003'); await count('1件');
    await input.fill(''); await select.selectOption('1'); await count('1件');
    await input.fill('一致しない'); await count('0件');
    assert.equal(await page.locator('#siteSearchResults').innerText(), '該当する工事物件はありません');
    await input.fill(''); await select.selectOption('');
    await input.fill('旧庁舎'); await count('0件');
    await page.locator('#includeHiddenSites').check(); await count('1件');
    assert.deepEqual(await page.locator('tbody td').allTextContents(), ['旧庁舎', 'HIDDEN-99']);
    await select.selectOption('2000');
    await page.locator('#includeHiddenSites').uncheck(); await count('0件');
    assert.equal(await select.inputValue(), '');
    assert.equal(await select.locator('option[value="2000"]').count(), 0);
    await input.fill('安全表示'); await count('1件');
    assert.equal(await page.locator('tbody img, tbody b').count(), 0, 'render database values as text');
    assert.match(await page.locator('tbody').innerText(), /<img/);
    for (const width of [320, 375, 768, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `no overflow at ${width}px`);
    }
    await mkdir(join(root, 'tmp', 'site-search'), { recursive: true });
    await input.fill('中央'); await count('1件');
    await page.setViewportSize({ width: 375, height: 844 });
    await page.screenshot({ path: join(root, 'tmp', 'site-search', `${role}-mobile.png`), fullPage: true });
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.screenshot({ path: join(root, 'tmp', 'site-search', `${role}-tablet.png`), fullPage: true });
    await page.evaluate(() => document.documentElement.dataset.portalTheme = 'dark');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: join(root, 'tmp', 'site-search', `${role}-dark.png`), fullPage: true });
    await page.evaluate(() => document.documentElement.dataset.portalTheme = 'light');
    failure = true;
    await page.locator('#reloadSiteSearch').click();
    await page.locator('#siteSearchError').waitFor({ state: 'visible' });
    assert.match(await page.locator('#siteSearchError').innerText(), /権限/);
    assert.equal(await page.locator('tbody').count(), 0);
    assert.equal(await select.isDisabled(), true);
    failure = false; networkFailure = true;
    await page.locator('#reloadSiteSearch').click();
    await page.waitForFunction(() => document.getElementById('siteSearchError').textContent.includes('通信'));
    networkFailure = false; delay = true;
    await input.fill(''); await page.locator('#reloadSiteSearch').click();
    await page.waitForFunction(() => document.getElementById('siteSearchStatus').textContent.includes('読み込み中'));
    assert.equal(await page.locator('#siteSearchResultSection').getAttribute('aria-busy'), 'true');
    // Changing the scope while loading must not publish the older response.
    await page.locator('#includeHiddenSites').check();
    await count('1004件'); delay = false;
    await page.locator('.portal-side-menu-toggle').click();
    const links = await page.locator('.portal-side-menu-nav a').evaluateAll(nodes => nodes.map(n => n.getAttribute('href')));
    const index = links.indexOf('tool-management.html');
    assert.deepEqual(links.slice(index, index + 3), ['tool-management.html', 'site-search.html', 'settings.html']);
    await page.goto(`${base}/home.html`);
    await page.waitForFunction(() => !document.getElementById('toolManagementMenu').classList.contains('hidden'));
    assert.equal(await page.locator('#adminMenu').isVisible(), role === 'all');
    assert.equal(await page.locator('#siteSearchMenu').isVisible(), true);
    const menuOrder = await page.locator('#toolManagementMenu, #siteSearchMenu, #settingsMenu').evaluateAll(nodes => nodes.map(n => ({ id: n.id, top: n.getBoundingClientRect().top })).sort((a,b) => a.top - b.top).map(n => n.id));
    assert.deepEqual(menuOrder, ['toolManagementMenu', 'siteSearchMenu', 'settingsMenu']);
    assert.equal(await page.locator('#toolManagementMenu').getAttribute('href'), 'tool-management.html');
    assert.equal(await page.locator('#settingsMenu').getAttribute('href'), 'settings.html?v=2');
    assert.deepEqual(errors, []); assert.deepEqual(blocked, []);
    await context.close();
    console.log(`PASS ${role}: name/official/selection/number/visibility/empty/error/retry/race/pagination/XSS/responsive/menu`);
  }
  const context = await browser.newContext({ serviceWorkers: 'block' });
  await context.route('**/*', route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
  const page = await context.newPage();
  await page.goto(`${base}/site-search.html`);
  await page.waitForURL('**/login.html');
  await context.close();
  console.log('PASS logged-out redirect; all external requests mocked or blocked');
  const worker = await readFile(join(root, 'service-worker.js'), 'utf8');
  for (const asset of ['./site-search.html', './site-search.js?v=1', './site-search.css?v=1']) {
    assert.ok(worker.includes(`"${asset}"`), `precache ${asset}`);
    await readFile(join(root, asset.split('?')[0]));
  }
  assert.ok(worker.includes('staff-portal-v96'));
  console.log('PASS new page assets included in updated service worker cache');
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
