import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const source = async name => (await readFile(new URL(`../${name}`,import.meta.url),'utf8')).replaceAll('\r\n','\n');
const apiSource = await source('tool-registration.js');
const entries = [
  {tool_group:'その他',tool_name:'新工具',active:true,code_prefix:'NEW',inspection_required:false},
  {tool_group:'その他',tool_name:'旧工具',active:false,code_prefix:'OLD'}
];
for (const scenario of ['active','empty','missing','denied','network']) {
  const calls = [];
  const context = vm.createContext({window:{},PORTAL_SUPABASE_URL:'https://test.invalid',
    portalFetch:async url => {
      calls.push(url);
      if (url.includes('rpc/')) return {ok:true,json:async()=>[{tool_name:'legacy'}]};
      if (scenario === 'network') throw new Error('offline');
      if (scenario === 'missing') return {ok:false,json:async()=>({code:'PGRST205'})};
      if (scenario === 'denied') return {ok:false,json:async()=>({code:'42501'})};
      return {ok:true,json:async()=>scenario === 'empty' ? [] : entries};
    }});
  vm.runInContext(apiSource,context);
  const api = context.window.ToolRegistration;
  if (['denied','network'].includes(scenario)) {
    await assert.rejects(()=>api.loadCatalog());
    assert.equal(calls.length,1);
  } else {
    const result = await api.loadCatalog();
    assert.deepEqual(Array.from(result,x=>x.tool_name),scenario === 'active' ? ['新工具'] : scenario === 'empty' ? [] : ['legacy']);
    assert.equal(calls.length,scenario === 'missing' ? 2 : 1);
  }
}
console.log('PASS: active filtering, empty master stays empty, missing-table fallback, permissions/network fail closed');

const master = await source('tool-master.js');
const namesFunction = master.slice(master.indexOf('function getToolNamesForGroup('),master.indexOf('function updateToolNameOptions('));
const context = vm.createContext({toolCatalog:entries,toolRecords:[{tool_group:'その他',tool_name:'過去工具'}],TOOL_NAME_OPTIONS:{}});
vm.runInContext(namesFunction,context);
assert.deepEqual(Array.from(context.getToolNamesForGroup('その他')),['新工具']);
assert.deepEqual(Array.from(context.getToolNamesForGroup('切断工具')),[]);
context.toolCatalog = null;
assert.deepEqual(Array.from(context.getToolNamesForGroup('その他')),['過去工具']);
console.log('PASS: administrator candidates use exact group and active master, legacy fallback preserved');

const shared = await source('shared-tools.js');
const select = {value:'',disabled:false,children:[],appendChild(item){this.children.push(item);}};
const searchContext = vm.createContext({sharedToolRecords:[{tool_group:'その他',tool_name:'過去工具'}],
  searchToolCatalog:entries, toolGroupSelect:{value:'その他'}, toolNameSelect:select,
  getToolGroup:item=>item.tool_group,document:{createElement:()=>({})}});
vm.runInContext(shared.slice(shared.indexOf('function updateToolNameSelect('),shared.indexOf('function updateStockToolNameSelect(')),searchContext);
searchContext.updateToolNameSelect();
assert.deepEqual(select.children.map(item=>item.value).sort(),['新工具','旧工具','過去工具'].sort());
console.log('PASS: shared search includes active/inactive catalog and historical tools');

for (const file of ['tool-master.js','tool-registration.js','tool-catalog-admin.js','personal-tool-registration.js','shared-tools.js','service-worker.js']) new vm.Script(await source(file),{filename:file});
console.log('PASS: changed JavaScript syntax');

const migration = await source('supabase/add_tool_catalog.sql');
const preflight = await source('supabase/tool_catalog_preflight.sql');
const fixture = await source('tests/tool-catalog-migration.test.sql');
const extractSeed = text => text.split('-- BEGIN SEED QUERY\n')[1].split('\n-- END SEED QUERY')[0];
assert.equal(extractSeed(migration),extractSeed(preflight));
assert.equal(extractSeed(fixture),extractSeed(migration).replace('from public.tools t','from test_tools t'));
assert.doesNotMatch(migration,/\b(update|delete\s+from|insert\s+into)\s+public\.tools\b/i);
assert.match(migration,/on conflict \(tool_group, tool_name\) do nothing/i);
assert.doesNotMatch(migration,/raise exception/);
console.log('PASS: migration/preflight/SQL fixture use identical classification, no tools DML, rerun preserves master');
