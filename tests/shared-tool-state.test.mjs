import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
const read = name => readFile(new URL('../' + name, import.meta.url), 'utf8');
const common = await read('shared-tool-state.js');
const ctx = vm.createContext({ window: {} });
vm.runInContext(common, ctx);
const state = ctx.window.SharedToolState;
const base = { id: 1, ownership_type: 'shared', active: true, checkout_managed: true };
for (const status of ['available', 'in_use', null, 'repair', 'stopped', 'disposed']) {
  for (const current_site_id of [null, 10]) {
    const tool = { ...base, status, current_site_id };
    const special = ['repair', 'stopped', 'disposed'].includes(status);
    assert.equal(state.getDisplayToolStatus(tool), special ? status : current_site_id ? 'in_use' : 'available');
    assert.equal(state.canCheckout(tool), !special && current_site_id === null);
    assert.equal(state.canMoveOrReturn(tool), !special && current_site_id !== null);
    for (const overrides of [{active: false}, {checkout_managed: false}, {checkout_managed: null},
      {ownership_type: 'personal'}, {ownership_type: 'contractor'}]) {
      assert.equal(state.canCheckout({...tool, ...overrides}), false);
      assert.equal(state.canMoveOrReturn({...tool, ...overrides}), false);
    }
  }
}
console.log('PASS: common state matrix and shared-only operation eligibility');

for (const mode of ['checkout', 'move']) {
  const source = await read(`tool-${mode}.js`);
  new vm.Script(source);
  const start = source.indexOf(`async function ${mode}Tool()`);
  const end = source.indexOf('/* =========================================', start);
  for (const tool of [
    {...base, status:'available', current_site_id: mode === 'checkout' ? 10 : null},
    ...['repair','stopped','disposed'].map(status => ({...base,status,current_site_id:10})),
    {...base,active:false,current_site_id:10}
  ]) {
    const context = vm.createContext({window:ctx.window, currentTool:tool,
      [mode+'Message']: {}, portalFetch: () => { throw new Error('must not save'); }});
    vm.runInContext(source.slice(start,end), context);
    await context[mode+'Tool']();
    assert.equal(context[mode+'Message'].textContent, '現在操作できません');
  }
  console.log(`PASS: ${mode} rejects invalid shared state before saving`);
}

for (const name of ['shared-tools','tool-detail','tool-checkout','tool-move']) {
  const html = await read(name+'.html');
  assert.ok(html.indexOf('./shared-tool-state.js?v=1') < html.indexOf('./'+name+'.js'));
  assert.ok(html.includes('./shared-tool-state.js?v=1'));
}
const worker = await read('service-worker.js');
assert.ok(worker.includes('"./shared-tool-state.js?v=1"'));
const qr = await read('tool-qr-reader.js');
assert.match(qr, /tool-detail\.html\?id=/);
for (const name of ['shared-tools.js','tool-detail.js']) {
  const source = await read(name);
  const start = source.indexOf(name === 'shared-tools.js' ? 'async function returnTool(' : 'async function returnSharedTool(');
  const end = source.indexOf('/* =========================================', start);
  assert.doesNotMatch(source.slice(start,end), /PATCH|operated_by_employee_id|tool_history/);
  assert.match(source.slice(start,end), /SharedToolState\s*\.returnSharedTool/);
}
console.log('PASS: dependency order, PWA dependency, QR destination and RPC-only return paths');

const list = await read('shared-tools.js');
const start = list.indexOf('async function returnTool(');
const end = list.indexOf('/* =========================================', start);
let calls = 0, release;
const pending = new Promise(resolve => { release = resolve; });
const context = vm.createContext({
  window: {confirm:()=>true}, returningToolIds:new Set(),
  sharedToolRecords:[{...base,status:'available',current_site_id:10}],
  SUPABASE_URL:'https://example.invalid', alert(){}, console:{error(){}},
  renderCurrentToolSearch(){}, loadTools:async()=>{},
  portalFetch:async()=>{calls++;await pending;return {ok:true};}
});
vm.runInContext(common,context);
vm.runInContext(list.slice(start,end),context);
const first = context.returnTool(1);
await context.returnTool(1);
assert.equal(calls,1);
release();await first;
assert.equal(context.returningToolIds.size,0);
console.log('PASS: list return blocks duplicate submission and releases guard');
