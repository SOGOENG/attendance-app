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
  let refreshed = 0, hidden = 0;
  const context = vm.createContext({
    SUPABASE_URL: 'https://example.invalid',
    sharedToolRecords: scenario === 'missing' ? [] : [{ id: 42, tool_name: '工具' }],
    window: { confirm: () => scenario !== 'cancel' },
    alert: message => alerts.push(message),
    console: { error() {} },
    initialize: async () => { refreshed++; },
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
  assert.equal(hidden, scenario === 'success' ? 1 : 0);
  if (scenario === 'rpc-error') assert.match(alerts[0], /返却可能/);
  if (scenario === 'non-json-error') assert.equal(alerts[0], '工具の返却に失敗しました');
  if (scenario === 'network-error') assert.equal(alerts[0], '通信エラー');
  console.log(`PASS: ${scenario}`);
}
