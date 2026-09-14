import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../shared-tools.js', import.meta.url), 'utf8');
new vm.Script(source);
const start = source.indexOf('async function returnTool(');
const end = source.indexOf('/* =========================================', start);
const returnSource = source.slice(start, end);

for (const scenario of ['success', 'rpc-error', 'non-json-error', 'network-error', 'cancel', 'missing']) {
  const calls = [], alerts = [];
  let refreshed = 0, hidden = 0, rendered = 0;
  const context = vm.createContext({
    SUPABASE_URL: 'https://example.invalid',
    sharedToolRecords: scenario === 'missing' ? [] : [{ id: 42, tool_name: '工具' }],
    window: { confirm: () => scenario !== 'cancel' },
    alert: message => alerts.push(message),
    console: { error() {} },
    initialize: async () => { throw new Error("must not initialize"); },
    loadTools: async () => { refreshed++; },
    renderCurrentToolSearch: () => { rendered++; },
    sharedToolResultSection: { classList: { add: () => { hidden++; } } },
    portalFetch: async (url, options) => {
      calls.push({ url, options });
      if (scenario === 'network-error') throw new Error('通信エラー');
      return {
        ok: scenario === 'success',
        json: async () => {
          if (scenario === 'non-json-error') throw new Error('invalid JSON');
          return { message: 'この工具は現在返却可能な使用中工具ではありません' };
        }
      };
    }
  });
  vm.runInContext(returnSource, context);
  await context.returnTool(42);
  assert.equal(calls.length, ['cancel', 'missing'].includes(scenario) ? 0 : 1);
  for (const { url, options } of calls) {
    assert.equal(url, 'https://example.invalid/rest/v1/rpc/return_shared_tool');
    assert.equal(options.method, 'POST');
    assert.deepEqual(JSON.parse(options.body), { p_tool_id: 42 });
  }
  assert.equal(alerts.includes('工具を返却しました'), scenario === 'success');
  assert.equal(refreshed, scenario === 'success' ? 1 : 0);
  assert.equal(hidden, 0);
  assert.equal(rendered, scenario === 'success' ? 2 : 0);
  if (scenario === 'success') {
    assert.equal(context.sharedToolRecords[0].current_site_id, null);
    assert.equal(context.sharedToolRecords[0].assigned_employee_id, null);
    assert.equal(context.sharedToolRecords[0].status, 'available');
  }
  if (scenario === 'rpc-error') assert.match(alerts[0], /返却可能/);
  if (scenario === 'non-json-error') assert.equal(alerts[0], '工具の返却に失敗しました');
  if (scenario === 'network-error') assert.equal(alerts[0], '通信エラー');
  console.log(`PASS: ${scenario}`);
}

// Exercise the real search, summary, return and refresh functions together.
for (const mode of ['site', 'category', 'keyword', 'stock', 'refresh-error']) {
  const elements = new Map(), alerts = [], calls = [];
  let scrolls = 0, displayed = [];
  const element = id => {
    if (!elements.has(id)) {
      const classes = new Set(['hidden']);
      elements.set(id, {
        value: '', textContent: '', innerHTML: '',
        addEventListener() {},
        classList: { add: x => classes.add(x), remove: x => classes.delete(x),
          contains: x => classes.has(x) },
        scrollIntoView() { scrolls++; }
      });
    }
    return elements.get(id);
  };
  let records = Array.from({ length: 5 }, (_, i) => ({
    id: i + 1, tool_name: 'ドリル', tool_group: '電動工具',
    ownership_type: 'shared', active: true, checkout_managed: true,
    current_site_id: 10, assigned_employee_id: 7, status: 'available'
  }));
  const context = vm.createContext({
    document: { getElementById: element },
    window: { TOOL_GROUPS: ['電動工具'], confirm: () => true },
    alert: text => alerts.push(text), console: { error() {} },
    portalFetch: async (url, options) => {
      calls.push({ url, options });
      if (options?.method === 'POST') {
        assert.ok(url.endsWith('/rpc/return_shared_tool'));
        const payload = JSON.parse(options.body);
        assert.deepEqual(Object.keys(payload), ['p_tool_id']);
        records = records.map(t => t.id === payload.p_tool_id ? {
          ...t, current_site_id: null, assigned_employee_id: null, status: 'available'
        } : t);
        return { ok: true };
      }
      assert.ok(url.includes('/rest/v1/tools?'));
      if (mode === 'refresh-error') throw new Error('offline');
      return { ok: true, json: async () => records.map(t => ({ ...t })) };
    }
  });
  vm.runInContext(source.replace(/initialize\(\);\s*$/, ''), context);
  context.renderToolCards = tools => { displayed = Array.from(tools); };
  context.fixture = records.map(t => ({ ...t }));
  vm.runInContext("sharedToolRecords = fixture; siteNameMap.set('10', '現場A');", context);
  element('toolSiteSelect').value = '10';
  element('toolGroupSelect').value = element('stockGroupSelect').value = '電動工具';
  element('toolNameSelect').value = element('stockToolNameSelect').value = 'ドリル';
  element('sharedToolSearch').value = 'ドリル';
  const search = { site: 'searchBySite', category: 'searchByCategory',
    keyword: 'searchTools', stock: 'searchStock', 'refresh-error': 'searchBySite' }[mode];
  context[search]();
  assert.equal(displayed.length, mode === 'stock' ? 0 : 5);
  const title = element('sharedToolResultTitle').textContent;
  // Unsubmitted edits must not silently change the displayed search conditions.
  for (const id of ['toolSiteSelect', 'toolGroupSelect', 'toolNameSelect',
    'stockGroupSelect', 'stockToolNameSelect', 'sharedToolSearch']) element(id).value = '未検索の変更';
  for (let id = 1; id <= 5; id++) {
    await context.returnTool(id);
    assert.equal(element('sharedToolResultSection').classList.contains('hidden'), false);
    assert.equal(element('sharedToolResultTitle').textContent, title);
    assert.equal(element('toolSiteSelect').value, '未検索の変更');
    assert.equal(element('sharedToolSearch').value, '未検索の変更');
    assert.equal(displayed.filter(context.isToolInUse).length, mode === 'stock' ? 0 : 5 - id);
    assert.equal(displayed.filter(context.isToolAvailableForCheckout).length,
      ['stock', 'category', 'keyword'].includes(mode) ? id : 0);
    assert.match(element('sharedToolSummary').innerHTML, new RegExp(`${mode === 'stock' ? 0 : 5 - id}件`));
  }
  assert.equal(scrolls, 1, 'return refresh must not scroll back to the result heading');
  assert.equal(calls.filter(c => c.options?.method === 'POST').length, 5);
  assert.equal(alerts.filter(a => a === '工具を返却しました').length, 5);
  if (['site', 'refresh-error'].includes(mode)) {
    assert.equal(displayed.length, 0);
    assert.equal(element('sharedToolMessage').textContent, '該当する工具はありません');
  }
  if (mode === 'refresh-error') assert.equal(alerts.filter(a => /最新の工具一覧/.test(a)).length, 5);
  console.log(`PASS: ${mode} search retained across five returns, counts and empty state, no actor payload`);
}
