// Local HTML + mocked API only. No production access.
// PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs BROWSER_PATH=/path/to/chrome node this-file
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const root = fileURLToPath(new URL('../', import.meta.url));
const server = createServer(async (req, res) => {
  const file = new URL(req.url, 'http://localhost').pathname.slice(1);
  if (!/^[a-z0-9.-]+$/i.test(file)) { res.writeHead(404); return res.end(); }
  try {
    res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html; charset=utf-8');
    res.end(await readFile(join(root, file)));
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_PATH ? { executablePath: process.env.BROWSER_PATH } : {}) });
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  const errors = [], calls = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => localStorage.setItem('portalLoginUser', JSON.stringify({ id: 999, name: 'ローカル値' })));
  await page.route('**/portal-auth.js', route => route.fulfill({ contentType: 'text/javascript', body:
    'const PORTAL_THEME_KEY="theme",PORTAL_FONT_SIZE_KEY="font";window.portalFetch=(url,opts)=>fetch(url,opts);window.savePortalDisplayPreferences=()=>{};' }));
  await page.route('**/push-notifications.js*', r => r.fulfill({ contentType: 'text/javascript', body: 'window.isPushSupported=()=>false;' }));
  await page.route('https://cdn.jsdelivr.net/**', r => r.fulfill({ contentType: 'text/javascript', body: '' }));
  let selected = 10, failSave = false, failCollision = false, failList = false, failEmployee = false;
  const vehicles = [
    { id: 10, vehicle_number: 'V-010', vehicle_name: '通常車両' },
    { id: 11, vehicle_number: 'V-011', vehicle_name: '非常に長い車両名'.repeat(18) }
  ];
  await page.route('https://fgmvmbjnoyagnpygcbky.supabase.co/**', async route => {
    const req = route.request(), url = new URL(req.url());
    const body = req.postData() ? req.postDataJSON() : null;
    calls.push({ path: url.pathname, method: req.method(), body, query: url.search });
    if (url.pathname === '/auth/v1/user') return route.fulfill({ json: { id: 'auth-user-id' } });
    if (url.pathname.endsWith('/employees')) return route.fulfill(failEmployee ? { status: 500, json: { message: 'test' } } : { json: [
      { name: 'テスト社員', department: '工事部', job_title: '担当', profile_email: 'test@example.test', phone_number: '090', default_vehicle_id: selected }
    ] });
    if (url.pathname.endsWith('/vehicles')) {
      assert.equal(url.searchParams.get('active'), 'eq.true');
      return route.fulfill(failList ? { status: 500, json: { message: 'test' } } : { json: vehicles });
    }
    if (url.pathname.endsWith('/rpc/set_my_default_vehicle')) {
      if (failCollision) return route.fulfill({ status: 400, json: { message: 'vehicle_already_assigned' } });
      if (failSave) return route.fulfill({ status: 400, json: { message: 'active_vehicle_required' } });
      selected = body.p_vehicle_id;
      return route.fulfill({ json: selected });
    }
    if (url.pathname.endsWith('/functions/v1/update-own-profile')) return route.fulfill({ json: { ...body, success: true } });
    throw Error('Unexpected request: ' + req.method() + ' ' + url.href);
  });
  const base = 'http://127.0.0.1:' + server.address().port;
  const ready = () => page.waitForFunction(() => !document.getElementById('settingsDefaultVehicle').disabled);
  const save = async () => {
    await page.locator('#settingsVehicleSaveButton').click();
    await page.waitForFunction(() => document.getElementById('settingsVehicleMessage').classList.contains('is-success'));
  };
  await page.goto(base + '/settings.html'); await ready();
  assert.equal(await page.locator('#settingsDefaultVehicle').inputValue(), '10');
  assert.equal((await page.locator('#settingsDefaultVehicle option').allTextContents())[0], '未設定');
  assert((await page.locator('#settingsDefaultVehicle option').allTextContents())[1].startsWith('V-010'));
  await page.locator('#settingsDefaultVehicle').selectOption('11'); await save();
  assert.equal(selected, 11);
  assert.deepEqual(calls.at(-1).body, { p_vehicle_id: 11 });
  await page.reload(); await ready(); assert.equal(await page.locator('#settingsDefaultVehicle').inputValue(), '11');
  await page.screenshot({ path: join(tmpdir(), 'settings-vehicle-desktop.png'), fullPage: true });
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: join(tmpdir(), 'settings-vehicle-mobile.png'), fullPage: true });
  await page.locator('#settingsDefaultVehicle').selectOption(''); await save();
  assert.equal(selected, null); assert.deepEqual(calls.at(-1).body, { p_vehicle_id: null });
  await page.reload(); await ready(); assert.equal(await page.locator('#settingsDefaultVehicle').inputValue(), '');
  failSave = true; await page.locator('#settingsDefaultVehicle').selectOption('10');
  await page.locator('#settingsVehicleSaveButton').click();
  await page.waitForFunction(() => document.getElementById('settingsVehicleMessage').classList.contains('is-error'));
  assert.equal(selected, null); assert.equal(await page.locator('#settingsVehicleSaveButton').isEnabled(), true);
  failSave = false;
  failCollision = true; await page.locator('#settingsVehicleSaveButton').click();
  await page.waitForFunction(() => document.getElementById('settingsVehicleMessage').textContent.includes('他の社員'));
  assert.equal(selected, null); failCollision = false;
  // Inactive current settings must not be silently cleared or resaved.
  selected = 99; await page.reload(); await ready();
  assert.equal(await page.locator('#settingsDefaultVehicle').inputValue(), '99');
  const count = calls.filter(c => c.path.endsWith('/rpc/set_my_default_vehicle')).length;
  await page.locator('#settingsVehicleSaveButton').click();
  assert.equal(calls.filter(c => c.path.endsWith('/rpc/set_my_default_vehicle')).length, count);
  await page.locator('#settingsDefaultVehicle').selectOption(''); await save(); assert.equal(selected, null);
  // Vehicle failure must not disable or alter the existing email/phone workflow.
  failList = true; await page.reload();
  await page.waitForFunction(() => document.getElementById('settingsVehicleMessage').classList.contains('is-error'));
  assert.equal(await page.locator('#settingsVehicleSaveButton').isDisabled(), true);
  await page.locator('#settingsProfileEmail').fill('new@example.test');
  await page.locator('#settingsProfilePhone').fill('080');
  await page.locator('#settingsProfileSaveButton').click();
  await page.waitForFunction(() => document.getElementById('settingsProfileMessage').classList.contains('is-success'));
  assert.deepEqual(calls.at(-1).body, { profile_email: 'new@example.test', phone_number: '080' });
  failList = false; failEmployee = true; await page.reload();
  await page.waitForFunction(() => document.getElementById('settingsVehicleMessage').classList.contains('is-error'));
  assert.equal(await page.locator('#settingsVehicleSaveButton').isDisabled(), true);
  assert(!calls.some(c => c.path.endsWith('/employees') && c.method !== 'GET'));
  assert.deepEqual(errors, []);
  console.log('PASS settings vehicle: active list, saved/null/inactive values, RPC only, clear, error recovery, independent profile save, PC/390px/320px overflow.');
  console.log('Screenshots: ' + join(tmpdir(), 'settings-vehicle-desktop.png') + ', ' + join(tmpdir(), 'settings-vehicle-mobile.png'));
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
