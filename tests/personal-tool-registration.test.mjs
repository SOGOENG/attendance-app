import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = async name => readFile(new URL(`../${name}`, import.meta.url), 'utf8');
const entrySource = await source('tool-inspection-entry.js');
const categorySource = entrySource.slice(entrySource.indexOf('const CATEGORY_CONFIG = '));
const categoryConfig = vm.runInNewContext(categorySource.slice(0,categorySource.indexOf('\n};')+3) + '\nCATEGORY_CONFIG');
const personalHtml = await source('personal-tools.html');
const categorySelect = personalHtml.match(/<select name="inspectionCategory"[^>]*>([\s\S]*?)<\/select>/)[1];
const categoryOptions = [...categorySelect.matchAll(/<option value="([^"]+)">([^<]+)<\/option>/g)];
assert.deepEqual(categoryOptions.map(m => m[1]),Object.keys(categoryConfig).filter(key => key !== 'battery'));
categoryOptions.forEach(([,value,label]) => assert.equal(label,categoryConfig[value].name));
console.log('PASS: personal category options match CATEGORY_CONFIG excluding battery');
class Element {
  constructor() {
    this.value = ''; this.options = []; this.disabled = false;
    this.textContent = ''; this.events = {}; this.attributes = {};
    const classes = new Set(['hidden']);
    this.classList = { add: x => classes.add(x), remove: x => classes.delete(x),
      contains: x => classes.has(x), toggle: (x, on) => on ? classes.add(x) : classes.delete(x) };
  }
  addEventListener(name, handler) { this.events[name] = handler; }
  replaceChildren(...items) { this.options = items; this.value = ''; }
  add(item) { this.options.push(item); }
  setAttribute(name, value) { this.attributes[name] = value; }
  closest() { return this.label ||= new Element(); }
  focus() {}
  reportValidity() { return true; }
  reset() { Object.values(this.elements).forEach(e => { e.value = ''; }); }
}

const elements = new Map();
const get = id => { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id); };
const form = get('personalToolRegistrationForm');
form.elements = Object.fromEntries(['group','toolName','latheSize','inspectionCategory','specification','note','manufacturer','modelNumber','serialNumber','performance'].map(n => [n,new Element()]));
const save = new Element();
form.querySelector = () => save;
const calls = [];
let refreshCount = 0, failRefresh = false, failSave = false, pending;
const context = vm.createContext({
  window: {}, document: { getElementById: get },
  Option: function(text, value) { this.text = text; this.value = value; },
  ToolRegistration: {
    loadCatalog: async () => [
      {tool_group:'充電工具',tool_name:'充電インパクト',},
      {tool_group:'配管加工機',tool_name:'旋盤',},
      {tool_group:'その他',tool_name:'複数区分の工具'}
    ],
    registerPersonal: async values => {
      calls.push(values);
      if (failSave) throw new Error('採番設定がありません');
      if (pending) await pending;
      return { management_code:'BI-123',assigned_employee_id:7 };
    }
  }
});
vm.runInContext(await source('personal-tool-registration.js'), context);
context.window.initializePersonalToolRegistration(async id => {
  assert.equal(id,7); refreshCount++; if(failRefresh) throw new Error('通信エラー');
});
const open = get('personalToolRegisterOpen'), message = get('personalToolRegistrationMessage');
assert.equal(get('personalToolRegistration').classList.contains('hidden'),false);
await open.events.click();
assert.equal(form.classList.contains('hidden'),false);
form.elements.group.value = '充電工具'; form.elements.group.events.change();
assert.deepEqual(form.elements.toolName.options.map(o => o.value),['','充電インパクト']);
form.elements.toolName.value = '充電インパクト'; form.elements.toolName.events.change();
assert.match(get('personalToolInspectionHint').textContent,/点検対象外/);
assert.equal(save.disabled,false);
assert.equal(form.elements.inspectionCategory.disabled,true);
assert.equal(form.elements.inspectionCategory.required,false);
let release;
pending = new Promise(resolve => { release = resolve; });
const submitting = form.events.submit({preventDefault(){}});
await form.events.submit({preventDefault(){}});
assert.equal(calls.length,1,'double submit is blocked');
release(); await submitting; pending = null;
assert.equal(refreshCount,1);
assert.equal(calls[0].p_inspection_category,null);
for (const key of ['p_manufacturer','p_model_number','p_serial_number','p_performance']) assert.equal(calls[0][key],null);
assert.match(message.textContent,/工具を登録しました.*BI-123/);
assert.deepEqual(Object.keys(calls[0]).sort(),['p_group','p_inspection_category','p_lathe_size','p_manufacturer','p_model_number','p_name','p_note','p_performance','p_serial_number','p_specification']);
assert.equal(form.classList.contains('hidden'),true);
await open.events.click();
form.elements.group.value = '配管加工機'; form.elements.group.events.change();
form.elements.toolName.value = '旋盤'; form.elements.toolName.events.change();
assert.equal(form.elements.latheSize.required,true);
form.elements.group.value = 'その他'; form.elements.group.events.change();
form.elements.toolName.value = '複数区分の工具'; form.elements.toolName.events.change();
assert.equal(save.disabled,true);
const beforeMissing = calls.length;
await form.events.submit({preventDefault(){}});
assert.equal(calls.length,beforeMissing,'missing category does not submit');
for (const selected of ['3p','double_insulated','cord_reel','ac_welder','dc_welder']) {
  await open.events.click();
  form.elements.group.value = 'その他'; form.elements.group.events.change();
  form.elements.toolName.value = '複数区分の工具'; form.elements.toolName.events.change();
  form.elements.manufacturer.value = ' メーカーA ';
  form.elements.modelNumber.value = ' MODEL-01 ';
  form.elements.serialNumber.value = ' 000123 ';
  form.elements.performance.value = ' 100V ';
  form.elements.inspectionCategory.value = selected;
  form.elements.inspectionCategory.events.change();
  assert.equal(save.disabled,false);
  await form.events.submit({preventDefault(){}});
  assert.equal(calls.at(-1).p_inspection_category,selected);
  assert.equal(calls.at(-1).p_manufacturer,'メーカーA');
  assert.equal(calls.at(-1).p_model_number,'MODEL-01');
  assert.equal(calls.at(-1).p_serial_number,'000123');
  assert.equal(calls.at(-1).p_performance,'100V');
}
await open.events.click();
form.elements.group.value = '充電工具'; form.elements.group.events.change();
form.elements.toolName.value = '充電インパクト'; form.elements.toolName.events.change();
failSave = true;
await form.events.submit({preventDefault(){}});
assert.match(message.textContent,/登録できませんでした.*採番設定/);
assert.equal(form.classList.contains('hidden'),false);
assert.equal(form.elements.toolName.value,'充電インパクト');
failSave = false; failRefresh = true;
await form.events.submit({preventDefault(){}});
assert.match(message.textContent,/工具を登録しました.*再登録せず/);
console.log('PASS: catalog filtering, inspection hint, lathe, double submit, payload, success, errors, refresh failure');

const adminSource = await source('tool-master.js');
const saveFunction = adminSource.slice(adminSource.indexOf('async function saveTool()'),adminSource.indexOf('function startToolEdit('));
for (const scenario of ['automatic','manual','edit']) {
  const requests = []; let loads = 0;
  const admin = vm.createContext({
    clearToolMessage(){}, validateTool(){}, showToolMessage(message){throw new Error(message);},
    editingToolId:{value:scenario === 'edit' ? '10' : ''},
    toolManagementCode:{readOnly:scenario === 'automatic'},latheSizeSelect:{value:''},
    createToolData:()=>({management_code:'BI-001',tool_name:'充電インパクト'}),
    window:{confirm:()=>true},SUPABASE_URL:'https://test.invalid',
    ToolRegistration:{request:async (...args)=>{requests.push(args);return {management_code:'BI-002'};}},
    portalFetch:async (...args)=>{requests.push(args);return {ok:true};},
    loadTools:async()=>{loads++;}, closeToolForm(){},alert(){},console
  });
  vm.runInContext(saveFunction,admin); await vm.runInContext('saveTool()',admin);
  assert.equal(loads,1);
  assert.equal(requests.length,1);
  assert.equal(requests[0][1].method,scenario === 'edit' ? 'PATCH':'POST');
  assert.equal(requests[0][0].includes('rpc/register_admin_tool'),scenario === 'automatic');
}
console.log('PASS: administrator automatic registration, manual registration, existing edit');

for (const arrayResponse of [false,true]) {
  const tool = {management_code:'BI-321',assigned_employee_id:7};
  const requests = [];
  const api = vm.createContext({window:{},PORTAL_SUPABASE_URL:'https://test.invalid',
    portalFetch:async (...args)=>{
      requests.push(args);
      return {ok:true,json:async()=>arrayResponse ? [tool] : tool};
    }
  });
  vm.runInContext(await source('tool-registration.js'),api);
  const saved = await api.window.ToolRegistration.registerPersonal({p_group:'充電工具',p_name:'充電インパクト'});
  assert.equal(saved.management_code,'BI-321');
  assert.equal(requests[0][0],'https://test.invalid/rest/v1/rpc/register_personal_tool');
}
console.log('PASS: RPC object and row-array responses');

for (const name of ['tool-registration.js','personal-tool-registration.js','personal-tools.js','tool-master.js','service-worker.js']) {
  new vm.Script(await source(name),{filename:name});
}
console.log('PASS: all changed JavaScript parses');

const fullSql = await source('supabase/personal_tool_registration.sql');
const incrementalSql = await source('supabase/add_personal_tool_registration_details.sql');
const extractRpc = sql => sql.slice(sql.indexOf('create or replace function public.register_personal_tool('),sql.indexOf('end;\n$;',sql.indexOf('create or replace function public.register_personal_tool('))+8);
assert.equal(extractRpc(fullSql),extractRpc(incrementalSql));
console.log('PASS: full and incremental RPC definitions match; optional details payload and empty NULL');
