// Local mocked API only; no production connection.
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
  await page.route('**/portal-auth.js', r => r.fulfill({ contentType: 'text/javascript', body:
    'const PORTAL_SUPABASE_URL="https://mock.invalid";window.portalFetch=(url,opts)=>fetch(url,opts);' }));
  const vehicles = [
    { id: 1, vehicle_number: '名古屋 400 あ 12-34', vehicle_name: 'ハイエース', active: true, note: '', updated_at: '2026-10-16T00:00:00Z' },
    { id: 2, vehicle_number: '名古屋 400 あ 56-78', vehicle_name: 'バン', active: true, note: '', updated_at: '2026-10-16T00:00:00Z' },
    { id: 3, vehicle_number: '名古屋 400 あ 99-99', vehicle_name: '長い車名'.repeat(30), active: true, note: '', updated_at: '2026-10-16T00:00:00Z' }
  ];
  const employees = [
    { id: 1, name: '全体管理者', department: '総務', active: true, default_vehicle_id: null },
    { id: 2, name: '社員B', department: '工事部', active: true, default_vehicle_id: 1 },
    { id: 3, name: '社員C', department: '工事部', active: true, default_vehicle_id: 2 }
  ];
  let denied = false;
  const assignments = () => employees.filter(e => e.default_vehicle_id != null).map(e => ({ employee_id: e.id, vehicle_id: e.default_vehicle_id }));
  await page.route('https://mock.invalid/**', async route => {
    const req = route.request(), method = new URL(req.url()).pathname.split('/').at(-1), body = req.postDataJSON();
    calls.push({ method, body });
    if (denied) return route.fulfill({ status: 403, json: { message: 'application_admin_required' } });
    if (method === 'admin_get_vehicle_master') return route.fulfill({ json: { vehicles, employees, assignments: assignments() } });
    if (method === 'admin_save_vehicle_master') {
      if (JSON.stringify(body.p_expected_assignments) !== JSON.stringify(assignments())) return route.fulfill({ status: 409, json: { message: 'vehicle_assignments_changed' } });
      const p = body.p_vehicle;
      const finalOwners = employees.map(e => ({ ...e }));
      body.p_assignments.forEach(a => { finalOwners.find(e => e.id === a.employee_id).default_vehicle_id = a.vehicle_id === 'saved' ? (p.id || vehicles.length + 1) : a.vehicle_id; });
      const disabledIds = [...body.p_deactivate_ids, ...(p.active ? [] : [p.id])];
      if (finalOwners.some(e => e.default_vehicle_id != null && disabledIds.includes(e.default_vehicle_id))) return route.fulfill({ status: 400, json: { message: 'deactivated_vehicle_still_assigned' } });
      let v = vehicles.find(v => v.id === p.id);
      if (!v) { v = { id: vehicles.length + 1 }; vehicles.push(v); }
      Object.assign(v, p, { id: v.id, updated_at: new Date().toISOString() });
      body.p_assignments.forEach(a => { employees.find(e => e.id === a.employee_id).default_vehicle_id = a.vehicle_id === 'saved' ? v.id : a.vehicle_id; });
      body.p_deactivate_ids.forEach(id => { vehicles.find(v => v.id === id).active = false; });
      return route.fulfill({ json: v.id });
    }
    throw Error('Unexpected RPC ' + method);
  });
  await page.goto('http://127.0.0.1:' + server.address().port + '/vehicle-admin.html');
  const ready = () => page.waitForFunction(() => !document.getElementById('newVehicle').disabled);
  await ready(); assert.equal(await page.locator('.vehicle-item').count(), 3);
  assert((await page.locator('.vehicle-item').first().innerText()).includes('社員B'));
  await page.locator('#newVehicle').click();
  await page.locator('#vehicleNumber').fill(' '); await page.locator('#vehicleName').fill('新車');
  await page.locator('#saveVehicle').click(); assert((await page.locator('#vehicleFormMessage').textContent()).includes('入力'));
  await page.locator('#vehicleNumber').fill('名古屋 400 あ 22-22'); await page.locator('#vehicleEmployee').selectOption('2');
  assert(await page.locator('#replaceLabel').isVisible()); await page.locator('#deactivatePrevious').check();
  page.once('dialog', d => d.accept()); await page.locator('#saveVehicle').click();
  await page.waitForFunction(() => document.getElementById('vehicleEdit').hidden); await ready();
  let call = calls.findLast(c => c.method === 'admin_save_vehicle_master');
  assert.deepEqual(call.body.p_assignments, [{ employee_id: 2, vehicle_id: 'saved' }]);
  assert.deepEqual(call.body.p_deactivate_ids, [1]);
  assert.equal(vehicles[0].active, false); assert.equal(employees[1].default_vehicle_id, 4);
  await page.locator('[data-edit="2"]').click(); await page.locator('#vehicleEmployee').selectOption('2');
  assert(await page.locator('#swapLabel').isVisible()); await page.locator('#swapVehicles').check();
  page.once('dialog', d => d.accept()); await page.locator('#saveVehicle').click();
  await page.waitForFunction(() => document.getElementById('vehicleEdit').hidden); await ready();
  call = calls.findLast(c => c.method === 'admin_save_vehicle_master');
  assert.deepEqual(call.body.p_assignments, [{ employee_id: 3, vehicle_id: 4 }, { employee_id: 2, vehicle_id: 'saved' }]);
  assert.equal(employees[1].default_vehicle_id, 2); assert.equal(employees[2].default_vehicle_id, 4);
  await page.locator('[data-edit="2"]').click(); await page.locator('#vehicleActive').selectOption('false');
  page.once('dialog', d => d.accept()); await page.locator('#saveVehicle').click();
  await page.waitForFunction(() => document.getElementById('vehicleFormMessage').textContent.includes('使用社員が残って'));
  assert.equal(vehicles[1].active, true);
  await page.locator('#vehicleEmployee').selectOption('');
  page.once('dialog', d => d.accept()); await page.locator('#saveVehicle').click();
  await page.waitForFunction(() => document.getElementById('vehicleEdit').hidden); await ready();
  assert.equal(vehicles[1].active, false); assert.equal(employees[1].default_vehicle_id, null);
  // Self-setting changes are reflected from the same source on focus/reload.
  employees[1].default_vehicle_id = 3;
  await page.evaluate(() => window.dispatchEvent(new Event('focus'))); await ready();
  await page.waitForFunction(() => document.querySelector('[data-edit="3"]').closest('article').textContent.includes('社員B'));
  await page.screenshot({ path: join(tmpdir(), 'vehicle-admin-desktop.png'), fullPage: true });
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('[data-edit="3"]').click();
  await page.screenshot({ path: join(tmpdir(), 'vehicle-admin-mobile.png'), fullPage: true });
  employees[1].default_vehicle_id = null;
  await page.evaluate(() => window.dispatchEvent(new Event('focus'))); await ready();
  page.once('dialog', d => d.accept()); await page.locator('#saveVehicle').click();
  await page.waitForFunction(() => document.getElementById('vehicleFormMessage').textContent.includes('設定が変更'));
  assert(await page.locator('#vehicleEdit').isVisible());
  denied = true; await page.locator('#reloadVehicles').click();
  await page.waitForFunction(() => document.getElementById('vehicleMessage').textContent.includes('全体管理者'));
  assert(await page.locator('#newVehicle').isDisabled()); assert(await page.locator('#saveVehicle').isDisabled());
  assert(calls.every(c => c.method.startsWith('admin_')));
  assert.deepEqual(errors, []);
  console.log('PASS vehicle admin UI: owner names, register/replacement, swap, disable, self-setting refresh, stale conflict, admin denial, PC/390px/320px.');
  console.log('Screenshots: ' + join(tmpdir(), 'vehicle-admin-desktop.png') + ', ' + join(tmpdir(), 'vehicle-admin-mobile.png'));
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
