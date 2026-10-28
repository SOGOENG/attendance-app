import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import assert from 'node:assert/strict';

const read = file => readFile(new URL(`../${file}`, import.meta.url), 'utf8');
const escape = value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const serviceWorker = await read('service-worker.js');
for (const [html, script] of [['applications-admin.html', 'applications-admin.js'], ['application-print.html', 'application-print.js']]) {
  const match = (await read(html)).match(new RegExp(`${script.replace('.', '\\.')}\\?v=([0-9]+)`));
  assert.ok(match, `versioned script in ${html}`);
  assert.ok(serviceWorker.includes(`./${script}?v=${match[1]}`), `matching service worker cache for ${script}`);
}
const adminSource = await read('applications-admin.js');
const historySource = adminSource.slice(adminSource.indexOf('async function renderPaidUsageHistory('), adminSource.indexOf('\nasync function saveBalance('));
assert.ok(historySource.startsWith('async function renderPaidUsageHistory('));
const elements = { balanceEmployee: { value: '7' }, paidUsageList: { innerHTML: '' } };
let historyQuery;
const details = [
  { application_id: 1, start_date: '2026-10-19', end_date: '2026-10-19', days: 1, day_part: 'full', approved_remaining_days: 3 },
  { application_id: 2, start_date: '2026-11-07', end_date: '2026-11-07', days: 1, day_part: 'full', approved_remaining_days: 0 },
  { application_id: 3, start_date: '2025-05-01', end_date: '2025-05-01', days: 0.5, day_part: 'am', approved_remaining_days: null }
];
const renderHistory = runInNewContext(`${historySource}; renderPaidUsageHistory`, {
  $: id => elements[id], req: async path => { historyQuery = path; return details; },
  dt: value => value || '-', esc: escape
});
await renderHistory(7, details.map(row => ({ id: row.application_id, submitted_at: '2026-01-01', approved_at: '2026-01-02' })));
assert.match(historyQuery, /approved_remaining_days/);
const cards = elements.paidUsageList.innerHTML.split('<article').slice(1);
assert.equal(cards.length, 3);
for (const [index, expected] of ['3日', '0日', '記録なし'].entries()) {
  assert.ok(cards[index].includes(`承認時の控除後残数：${expected}`));
}
assert.ok(!elements.paidUsageList.innerHTML.includes('現在残数：'));

const printSource = await read('application-print.js');
for (const [value, expected] of [[3, '3 日'], [0, '0 日'], [null, '記録なし']]) {
  const elements = Object.fromEntries(['printSheet', 'printMessage', 'printButton', 'backButton'].map(id => [id, { hidden: true, innerHTML: '', addEventListener() {} }]));
  const requests = [];
  const document = {
    getElementById: id => elements[id],
    createElement: () => ({ set textContent(value) { this.innerHTML = escape(value); }, innerHTML: '' })
  };
  const portalFetch = async url => {
    const path = String(url).split('/rest/v1/')[1]; requests.push(path);
    let data;
    if (path === 'rpc/is_application_admin') data = true;
    else if (path === 'rpc/assert_application_printable') data = null;
    else if (path.startsWith('applications?')) data = [{ id: 1, employee_id: 7, application_type: 'paid_leave', status: 'approved', approved_by_employee_id: 1 }];
    else if (path.startsWith('employees?')) data = [{ id: 7, name: '社員' }, { id: 1, name: '承認者' }];
    else if (path.startsWith('paid_leave_application_details?')) data = [{ start_date: '2026-10-19', end_date: '2026-10-19', days: 1, approved_remaining_days: value }];
    else if (path.startsWith('paid_leave_balances?')) data = [{ granted_days: 10, used_days: 2, remaining_days: 8 }];
    else throw new Error(`Unexpected request: ${path}`);
    return { ok: true, text: async () => JSON.stringify(data) };
  };
  runInNewContext(printSource, { document, portalFetch, PORTAL_SUPABASE_URL: 'https://example.test', URLSearchParams, location: { search: '?application_id=1' }, history: {}, window: {}, console });
  for (let i = 0; i < 30 && elements.printSheet.hidden; i++) await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(elements.printSheet.hidden, false);
  assert.equal(elements.printSheet.innerHTML.split(`承認時の控除後残数　${expected}`).length - 1, 2);
  assert.match(elements.printSheet.innerHTML, /支給日数（印刷時点）　10 日/);
  assert.match(elements.printSheet.innerHTML, /累積使用日数（印刷時点）　2 日/);
  assert.ok(requests.some(path => path.startsWith('paid_leave_application_details?') && path.includes('approved_remaining_days')));
  assert.ok(!requests.find(path => path.startsWith('paid_leave_balances?')).includes('remaining_days'));
  assert.equal(requests.filter(path => path === 'rpc/assert_application_printable').length, 2);
}
console.log('PASS: saved approval balances in history and both print copies, zero, null, print-time totals and print authorization');
