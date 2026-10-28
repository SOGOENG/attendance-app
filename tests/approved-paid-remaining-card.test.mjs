import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import assert from 'node:assert/strict';

const source = await readFile(new URL('../applications-admin.js', import.meta.url), 'utf8');
const fn = source.slice(source.indexOf('async function loadApproved()'), source.indexOf('\nasync function openReview('));
assert.ok(fn.startsWith('async function loadApproved()'));
const apps = [
  { id: 51, employee_id: 1, application_type: 'paid_leave', approved_by_employee_id: 9 },
  { id: 52, employee_id: 2, application_type: 'paid_leave', approved_by_employee_id: 9 },
  { id: 53, employee_id: 3, application_type: 'paid_leave', approved_by_employee_id: 9 },
  { id: 54, employee_id: 4, application_type: 'paid_leave', approved_by_employee_id: 9 },
  { id: 55, employee_id: 5, application_type: 'comp_leave', approved_by_employee_id: 9 }
];
const paid = [17, 16, 0, null].map((approved_remaining_days, i) => ({
  application_id: 51 + i, start_date: '2026-10-19', end_date: '2026-10-19', days: 1, site_id: 12, approved_remaining_days
}));
const requests = [];
const element = { innerHTML: '' };
const req = async path => {
  requests.push(path);
  if (path.startsWith('applications?')) return apps;
  if (path.startsWith('paid_leave_application_details?')) return paid;
  if (path.startsWith('comp_leave_application_details?')) return [{ application_id: 55 }];
  if (path.startsWith('comp_leave_dates?') || path.startsWith('comp_leave_allocations?')) return [];
  if (path.startsWith('employees?')) return [{ id: 1, name: '市原 守' }, { id: 2, name: '八木 繁和' }, { id: 9, name: '承認者' }];
  if (path.startsWith('sites?')) return [{ id: 12, display_name: '現場' }];
  throw Error(`Unexpected request: ${path}`);
};
const render = runInNewContext(`${fn}; loadApproved`, {
  isAdmin: () => true, req, $: () => element, types: [], emp: () => '-', dt: value => value || '-',
  esc: value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;'),
  document: { querySelectorAll: () => [], querySelector: () => null },
  window: { location: { search: '' } }, URLSearchParams
});
await render();
assert.ok(requests[0].includes('status=eq.approved'));
assert.ok(requests.find(path => path.startsWith('paid_leave_application_details?')).includes('approved_remaining_days'));
const cards = element.innerHTML.split('<article').slice(1);
assert.equal(cards.length, 5);
for (const [i, expected] of ['17日', '16日', '0日', '記録なし'].entries()) {
  const card = cards[i];
  assert.ok(card.includes(`承認時の控除後残数：${expected}`));
  assert.ok(card.indexOf('承認者：') < card.indexOf('承認時の控除後残数：'));
  assert.ok(card.indexOf('承認時の控除後残数：') < card.indexOf('現場：'));
}
assert.ok(cards[0].includes('市原 守'));
assert.ok(cards[1].includes('八木 繁和'));
assert.ok(!cards[4].includes('承認時の控除後残数'));
console.log('PASS: approved paid application cards use each saved balance, including zero and null, and exclude comp leave');
