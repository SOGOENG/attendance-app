// Local browser and mocked authorization only. No production traffic.
import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import { pathToFileURL, fileURLToPath } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
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
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  let admin = true, receipts = true, failure = false, receiptCalls = 0, hangReceipts = false, adminFailure = false;
  await page.addInitScript(() => {
    localStorage.setItem('portalLoginUser', JSON.stringify({ id: 1, adminScope: 'all' }));
    localStorage.setItem('portalAuthSession', JSON.stringify({ accessToken: 'local-test-token', expiresAt: Date.now() + 3600000 }));
  });
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.hostname.endsWith('.supabase.co')) {
      const body = route.request().postDataJSON();
      assert.equal(route.request().method(), 'POST');
      assert.equal(route.request().headers().authorization, 'Bearer local-test-token');
      if (url.pathname.endsWith('/is_application_admin')) return route.fulfill({ status: failure || adminFailure ? 500 : 200, json: admin });
      assert.equal(url.pathname, '/functions/v1/fuel-receipts');
      receiptCalls++;
      if (hangReceipts) return;
      assert.deepEqual(body, { action: 'access', data: {} });
      return route.fulfill({ status: failure ? 403 : 200, json: { manager: receipts, admin } });
    }
    assert.equal(url.hostname, '127.0.0.1', 'unexpected external traffic');
    return route.continue();
  });
  const url = process.env.PORTAL_TEST_URL || `http://127.0.0.1:${server.address().port}/admin.html`;
  const links = page.locator('#drivingAdminMenu a:visible');
  const toggle = page.locator('#drivingAdminMenu > summary');
  async function expandMenu() {
    assert.equal(await links.count(), 0, 'initially collapsed');
    await toggle.click();
    assert(await page.locator('#drivingAdminMenu').evaluate(n => n.open));
  }
  await page.goto(url);
  await page.waitForFunction(() => !document.getElementById('drivingAdminMenu').hidden);
  assert.equal(receiptCalls, 0, 'full admin must not wait for receipt service');
  await expandMenu();
  assert.deepEqual(await links.locator('h3').allTextContents(), ['運転日報CSV出力', '給油領収書管理', '月別提出状況']);
  assert.deepEqual(await links.evaluateAll(nodes => nodes.map(n => n.getAttribute('href'))), ['driving-report-csv-admin.html', 'fuel-receipts-admin.html', 'driving-report-status-admin.html']);
  assert.equal(await page.locator('a[href="driving-report-csv-admin.html"]').count(), 1);
  assert.equal(await page.locator('a[href="fuel-receipts-admin.html"]').count(), 1);
  assert(await page.locator('#drivingAdminMenu').evaluate(n => n.previousElementSibling.getAttribute('href') === 'near-miss-admin.html' && n.nextElementSibling.getAttribute('href') === 'schedule-admin.html'));
  await mkdir(new URL('../tmp/driving-admin-menu/', import.meta.url), { recursive: true });
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    await toggle.click();
    assert.equal(await links.count(), 0, `closed at ${width}`);
    await page.screenshot({ path: fileURLToPath(new URL(`../tmp/driving-admin-menu/${width}-closed.png`, import.meta.url)), fullPage: true });
    await toggle.press('Enter');
    assert.equal(await links.count(), 3, `keyboard open at ${width}`);
    assert(await page.locator('#drivingAdminMenu').evaluate(n => n.nextElementSibling.getBoundingClientRect().top >= n.querySelector('nav').getBoundingClientRect().bottom));
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `overflow at ${width}`);
    for (const link of await links.all()) assert(await link.evaluate(n => n.scrollWidth <= n.clientWidth));
    await page.screenshot({ path: fileURLToPath(new URL(`../tmp/driving-admin-menu/${width}.png`, import.meta.url)), fullPage: true });
  }
  admin = false;
  await page.reload();
  await page.waitForFunction(() => !document.getElementById('drivingAdminMenu').hidden);
  await expandMenu();
  assert.deepEqual(await links.locator('h3').allTextContents(), ['給油領収書管理']);
  adminFailure = true;
  await page.reload();
  await page.waitForFunction(() => !document.getElementById('drivingAdminMenu').hidden);
  await expandMenu();
  assert.deepEqual(await links.locator('h3').allTextContents(), ['給油領収書管理']);
  assert(await page.locator('#drivingAdminMessage').isVisible());
  adminFailure = false;
  receipts = false;
  await page.reload();
  await page.waitForLoadState('networkidle');
  assert(await page.locator('#drivingAdminMenu').isHidden());
  // A forged local all-admin flag cannot override the server's denial.
  assert.equal(await links.count(), 0);
  admin = true; receipts = true; failure = true;
  await page.reload();
  await page.waitForLoadState('networkidle');
  assert(await page.locator('#drivingAdminMenu').isHidden());
  assert(await page.locator('#drivingAdminMessage').isVisible());
  assert(await page.locator('#retryDrivingAdminAccess').isVisible());
  failure = false;
  await page.locator('#retryDrivingAdminAccess').click();
  await page.waitForFunction(() => !document.getElementById('drivingAdminMenu').hidden);
  await expandMenu();
  assert.equal(await links.count(), 3);
  assert(await page.locator('#retryDrivingAdminAccess').isHidden());
  hangReceipts = true;
  await page.reload();
  await page.waitForFunction(() => !document.getElementById('drivingAdminMenu').hidden);
  await expandMenu();
  assert.equal(await links.count(), 3, 'admin visible while receipt service unavailable');
  admin = false;
  await page.reload();
  await page.waitForFunction(() => !document.getElementById('retryDrivingAdminAccess').hidden, { timeout: 12000 });
  assert(await page.locator('#drivingAdminMenu').isHidden());
  assert.deepEqual(errors, []);
  console.log('PASS: real portal-auth.js with mocked API, admin independent of receipt service, accounting/denied/forged local admin/error/timeout/retry, order and destinations, PC 1440 / iPad 768 / iPhone 390 / narrow 320, no overflow or JS errors.');
} finally { await browser.close(); await new Promise(r => server.close(r)); }
