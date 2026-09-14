import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../tool-detail.js', import.meta.url), 'utf8');
new vm.Script(source);
function functionSource(name) {
  const match = new RegExp(`(?:async )?function ${name}\\(`).exec(source);
  const start = match?.index ?? -1;
  assert.ok(start >= 0);
  const nextMatch = /\n(?:async )?function /.exec(source.slice(start + 1));
  const next = nextMatch ? start + 1 + nextMatch.index : -1;
  const comment = source.indexOf('/* =========================================', start);
  return source.slice(start, Math.min(...[next, comment].filter(n => n >= 0)));
}
const context = vm.createContext({
  returningSharedTool: false,
  document: { createElement: () => ({ addEventListener(name, fn) { this[name] = fn; } }) },
  siteNameMap: new Map([['10', '桑名プール']]),
  getEmployeeDisplayName: () => '社員',
  formatInspectionCategory: () => '-'
});
for (const name of new Set(source.match(/\bdetail\w+/g))) {
  context[name] = { style: {}, textContent: '', children: [],
    set innerHTML(value) { this.html = value; this.children = []; },
    get innerHTML() { return this.html || ''; },
    appendChild(child) { this.children.push(child); } };
}
for (const name of ['getDisplayToolStatus', 'formatToolStatus',
  'updateDetailByOwnership', 'displayTool', 'displayActionButtons', 'returnSharedTool']) {
  vm.runInContext(functionSource(name), context);
}
const base = { id: 1, ownership_type: 'shared', status: 'available',
  current_site_id: 10, checkout_managed: true };
function render(overrides = {}) {
  context.currentTool = { ...base, ...overrides };
  context.displayTool();
  context.displayActionButtons();
  return context.detailActionButtons.innerHTML;
}
let buttons = render();
assert.equal(context.detailStatus.textContent, '使用中');
assert.match(buttons, /tool-move.html/);
assert.doesNotMatch(buttons, /tool-checkout.html/);
assert.equal(context.detailActionButtons.children[0].textContent, '返却');
render({ status: 'in_use' });
assert.equal(context.detailActionButtons.children[0].textContent, '返却');
console.log('PASS: shared tool with site shows in-use, move and return for available/in_use status');

buttons = render({ current_site_id: null });
assert.equal(context.detailStatus.textContent, '貸出可');
assert.match(buttons, /tool-checkout.html/);
assert.doesNotMatch(buttons, /tool-move.html/);
assert.equal(context.detailActionButtons.children.length, 0);
console.log('PASS: shared tool without site shows available and checkout');

for (const [status, label] of [['repair', '修理中'], ['stopped', '使用停止'], ['disposed', '廃棄']]) {
  for (const current_site_id of [null, 10]) {
    buttons = render({ status, current_site_id });
    assert.equal(context.detailStatus.textContent, label);
    assert.match(buttons, /現在操作できません/);
    assert.doesNotMatch(buttons, /tool-(checkout|move).html/);
    assert.equal(context.detailActionButtons.children.length, 0);
  }
}
console.log('PASS: special statuses take priority with and without a site');

buttons = render({ ownership_type: 'personal' });
assert.equal(buttons, '');
assert.equal(context.detailStatusRow.style.display, 'none');
assert.equal(context.detailActionSection.style.display, 'none');
console.log('PASS: personal tool status and actions remain hidden');

for (const current_site_id of [null, 10]) {
  assert.equal(render({ checkout_managed: false, current_site_id }), '');
}
console.log('PASS: unmanaged tools have no action buttons');

const worker = await readFile(new URL('../service-worker.js', import.meta.url), 'utf8');
new vm.Script(worker);
assert.match(worker, /const CACHE_NAME\s*=\s*"staff-portal-v76"/);
console.log('PASS: service worker cache version is v76; JavaScript syntax checks passed');

for (const scenario of ['success', 'rpc-error', 'non-json', 'network', 'cancel', 'refresh-error']) {
  render();
  const alerts = [], calls = [];
  let histories = 0;
  context.SUPABASE_URL = 'https://example.invalid';
  context.window = { confirm: () => scenario !== 'cancel' };
  context.alert = message => alerts.push(message);
  context.console = { error() {} };
  context.loadTool = async () => { if (scenario === 'refresh-error') throw new Error('refresh'); };
  context.loadHistory = async () => { histories++; };
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  context.portalFetch = async (url, options) => {
    calls.push({ url, options });
    await pending;
    if (scenario === 'network') throw new Error('通信エラー');
    return { ok: ['success', 'refresh-error'].includes(scenario), json: async () => {
      if (scenario === 'non-json') throw new Error('JSON');
      return { message: '返却できません' };
    } };
  };
  const button = context.detailActionButtons.children[0];
  const operation = button.click();
  if (scenario !== 'cancel') {
    assert.equal(button.disabled, true);
    await button.click(); // Duplicate submission must not create another RPC.
  }
  release();
  await operation;
  assert.equal(calls.length, scenario === 'cancel' ? 0 : 1);
  for (const { url, options } of calls) {
    assert.equal(url, 'https://example.invalid/rest/v1/rpc/return_shared_tool');
    assert.equal(options.method, 'POST');
    assert.deepEqual(JSON.parse(options.body), { p_tool_id: 1 });
  }
  const success = ['success', 'refresh-error'].includes(scenario);
  assert.equal(alerts.includes('工具を返却しました'), success);
  assert.equal(context.currentTool.current_site_id, success ? null : 10);
  assert.equal(context.returningSharedTool, false);
  assert.equal(histories, scenario === 'success' ? 1 : 0);
  if (success) {
    assert.equal(context.detailStatus.textContent, '貸出可');
    assert.match(context.detailActionButtons.innerHTML, /tool-checkout.html/);
    assert.equal(context.detailActionButtons.children.length, 0);
  }
  if (scenario === 'refresh-error') assert.match(alerts.at(-1), /返却は完了しましたが/);
  if (scenario === 'rpc-error') assert.equal(alerts[0], '返却できません');
  if (scenario === 'non-json') assert.equal(alerts[0], '工具の返却に失敗しました');
  console.log(`PASS: return ${scenario}, ID-only RPC, duplicate guard and display update`);
}

render({ ownership_type: 'contractor' });
assert.equal(context.detailActionButtons.children.length, 0, 'contractor has no shared return action');
