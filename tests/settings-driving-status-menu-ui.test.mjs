// Local browser with mocked authorization; no production requests.
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
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_PATH });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  let admin = true, failure = false;
  await page.addInitScript(() => {
    localStorage.setItem('portalLoginUser', JSON.stringify({ id: 1, adminScope: 'all' }));
    localStorage.setItem('portalAuthSession', JSON.stringify({ accessToken: 'local-test-token', expiresAt: Date.now() + 3600000 }));
  });
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.hostname.endsWith('.supabase.co')) {
      assert.equal(url.pathname, '/rest/v1/rpc/is_application_admin');
      assert.equal(route.request().method(), 'POST');
      assert.equal(route.request().headers().authorization, 'Bearer local-test-token');
      return route.fulfill({ status: failure ? 500 : 200, json: admin });
    }
    assert.equal(url.hostname, '127.0.0.1', 'unexpected external traffic');
    return route.continue();
  });
  await page.goto(`http://127.0.0.1:${server.address().port}/settings-admin.html`);
  await page.waitForLoadState('networkidle');
  assert.equal(await page.locator('a[href="driving-report-status-admin.html"], #drivingStatusMenu').count(), 0, 'duplicate settings entry removed');
  assert.deepEqual(errors, []);
  console.log('PASS settings: duplicate monthly status entry removed');
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
