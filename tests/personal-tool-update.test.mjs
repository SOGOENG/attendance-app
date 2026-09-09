import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const source = async name => readFile(new URL('../'+name,import.meta.url),'utf8');
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
let correctionCalls = []; let updateCalls = []; let refreshCount = 0, failRefresh = false, failSave = false, pending;
const context = vm.createContext({
  window: {}, document: { getElementById: get },
  Option: function(text, value) { this.text = text; this.value = value; },
  ToolRegistration: {
    loadCatalog: async () => [
      {tool_group:'充電工具',tool_name:'充電インパクト',},
      {tool_group:'配管加工機',tool_name:'旋盤',},
      {tool_group:'その他',tool_name:'複数区分の工具'},
      {tool_group:'別分類',tool_name:'複数区分の工具'}
    ],
    correctPersonalIdentity: async values => { correctionCalls.push(values); if (failSave) throw new Error('この工具はすでに履歴があるため、工具名は変更できません。管理者に連絡してください。'); return {management_code:'NEW-001',assigned_employee_id:7}; },
    updatePersonal: async values => { updateCalls.push(values); if (failSave) throw new Error("保存失敗"); if (pending) await pending; return {management_code:"KEEP-001",assigned_employee_id:7}; },
    registerPersonal: async values => {
      calls.push(values);
      if (failSave) throw new Error('採番設定がありません');
      if (pending) await pending;
      return { management_code:'BI-123',assigned_employee_id:7 };
    }
  }
});
vm.runInContext(await source('personal-tool-registration.js'), context);
const editor = context.window.initializePersonalToolRegistration(async id => {
  assert.equal(id,7); refreshCount++; if(failRefresh) throw new Error('通信エラー');
},7);

const own = {id:42,ownership_type:'personal',assigned_employee_id:7,management_code:'KEEP-001',tool_group:'配管加工機',tool_name:'旋盤',inspection_category:'3p',specification:'1IN',manufacturer:'メーカー',model_number:'M1',serial_number:'S1',performance:'100V',note:'備考'};
await editor.edit({...own,assigned_employee_id:8});
assert.equal(form.classList.contains('hidden'),true);
await editor.edit({...own,ownership_type:'shared'});
assert.equal(form.classList.contains('hidden'),true);
await editor.edit({...own,ownership_type:'contractor'});
assert.equal(form.classList.contains('hidden'),true);
await editor.edit(own);
assert.equal(get('personalToolFormTitle').textContent,'個人工具を修正');
assert.equal(save.textContent,'修正を保存');
assert.equal(get('personalToolFormGuide').textContent,'管理番号：KEEP-001');
assert.equal(get('personalToolCorrectIdentity').textContent,'工具名を訂正する');
assert.equal(get('personalToolIdentityHint').textContent,'工具名を訂正すると、管理番号もその工具用に自動変更されます。');
assert.equal(form.elements.group.closest('label').classList.contains('hidden'),true);
assert.equal(form.elements.latheSize.required,false);
for(const [field,value] of Object.entries({specification:'1IN',manufacturer:'メーカー',modelNumber:'M1',serialNumber:'S1',performance:'100V',note:'備考'})) assert.equal(form.elements[field].value,value);
failSave=true;
await form.events.submit({preventDefault(){}});
assert.equal(form.classList.contains('hidden'),false);
assert.equal(form.elements.modelNumber.value,'M1');
failSave=false;
let release;
pending=new Promise(resolve=>{release=resolve;});
const saving=form.events.submit({preventDefault(){}});
const before=updateCalls.length;
await form.events.submit({preventDefault(){}});
await editor.edit({...own,id:43});
assert.equal(updateCalls.length,before);
release();await saving;pending=null;
assert.equal(refreshCount,1);
assert.equal(updateCalls.at(-1).p_tool_id,42);
assert.deepEqual(Object.keys(updateCalls.at(-1)).sort(),['p_tool_id','p_group','p_name','p_specification','p_note','p_inspection_category','p_manufacturer','p_model_number','p_serial_number','p_performance'].sort());
assert.equal(calls.length,0);
await editor.edit(own);
assert.equal(form.elements.group.disabled,true);
assert.equal(form.elements.toolName.disabled,true);
get('personalToolCorrectIdentity').events.click();
assert.equal(form.elements.group.disabled,true);
assert.equal(form.elements.group.closest('label').classList.contains('hidden'),true);
assert.equal(form.elements.toolName.disabled,false);
assert.deepEqual(form.elements.toolName.options.map(o=>o.value),['','充電インパクト','旋盤','複数区分の工具']);
assert.equal(save.disabled,true,'correction must change identity');
assert.equal(get('personalToolIdentityHint').textContent,'工具名を訂正すると、管理番号もその工具用に自動変更されます。');
form.elements.toolName.value='充電インパクト';form.elements.toolName.events.change();
await form.events.submit({preventDefault(){}});
assert.equal(correctionCalls.at(-1).p_inspection_category,null);
assert.equal(correctionCalls.at(-1).p_group,'充電工具');
assert.equal(correctionCalls.at(-1).p_name,'充電インパクト');
assert.equal(correctionCalls.at(-1).p_tool_id,42);
assert.equal(correctionCalls.at(-1).p_lathe_size,null);
assert.equal('management_code' in correctionCalls.at(-1),false);
assert.match(get('personalToolRegistrationMessage').textContent,/NEW-001/);
await editor.edit({...own,tool_group:'充電工具',tool_name:'充電インパクト'});
get('personalToolCorrectIdentity').events.click();
form.elements.toolName.value='旋盤';form.elements.toolName.events.change();
assert.equal(form.elements.latheSize.required,true);
form.elements.latheSize.value='2IN';
form.elements.inspectionCategory.value='3p';form.elements.inspectionCategory.events.change();
failSave=true;
await form.events.submit({preventDefault(){}});
assert.equal(get('personalToolRegistrationMessage').textContent,'この工具はすでに点検や使用の記録があるため、工具名を訂正できません。管理者に連絡してください。');
assert.equal(correctionCalls.at(-1).p_group,'配管加工機');
assert.equal(form.classList.contains('hidden'),false);
assert.equal(correctionCalls.at(-1).p_lathe_size,'2IN');
failSave=false;
get('personalToolCorrectIdentity').events.click();
assert.equal(form.elements.group.value,'充電工具');
assert.equal(form.elements.toolName.value,'充電インパクト');
assert.equal(form.elements.group.disabled,true);
await form.events.submit({preventDefault(){}});
assert.equal(updateCalls.at(-1).p_group,'充電工具');
assert.equal('p_lathe_size' in updateCalls.at(-1),false);
console.log('PASS: separate correction mode, new code display, lathe renumbering input, history rejection and return to normal editing');
await get('personalToolRegisterOpen').events.click();
assert.equal(save.textContent,'登録する');
assert.equal(get('personalToolFormTitle').textContent,'個人工具の新規登録');
assert.equal(form.elements.group.disabled,false);
assert.equal(form.elements.group.closest('label').classList.contains('hidden'),false);
console.log('PASS: owner/shared guards, edit prefill, immutable payload, lathe without renumbering, retry, duplicate submit, battery rule, refresh and return to registration');
const html=await source('personal-tools.html');
assert.match(html,/<details id="personalToolOwnDetails" class="personal-tool-own-details">/);
const page=await source('personal-tools.js');
const render=page.slice(page.indexOf('function renderOwnPersonalTools'),page.indexOf('async function initializePersonalTools'));
const list={children:[],replaceChildren(){this.children=[];},appendChild(child){this.children.push(child);}};
const count={};const edited=[];
const cardContext=vm.createContext({personalToolRecords:[own,{...own,id:43,assigned_employee_id:8},{...own,id:44,ownership_type:'shared'}],personalToolTotalCount:count,
document:{getElementById:()=>list,createElement:()=>({children:[],appendChild(child){this.children.push(child);},addEventListener(name,fn){this[name]=fn;}})},escapeHtml:x=>String(x).replaceAll('<','&lt;'),formatToolStatus:x=>x,getDisplayStatus:()=> 'available'});
vm.runInContext(render,cardContext);cardContext.renderOwnPersonalTools(7,{edit:t=>edited.push(t.id)});
assert.equal(count.textContent,1);assert.equal(list.children.length,1);
for(const label of ['管理番号','規格','メーカー','型式','製造番号','性能','点検区分','状態','備考'])assert.ok(list.children[0].innerHTML.includes(label));
list.children[0].children[0].click();assert.deepEqual(edited,[42]);
cardContext.renderOwnPersonalTools(99,{});assert.equal(count.textContent,0);assert.match(list.textContent,/ありません/);
console.log('PASS: own cards only, all card fields, edit target and empty state');

for (const arrayResponse of [false,true]) {
  const requests=[];
  const api=vm.createContext({window:{},PORTAL_SUPABASE_URL:'https://test.invalid',portalFetch:async (...args)=>{
    requests.push(args);return {ok:true,json:async()=>arrayResponse?[{id:42}]:{id:42}};
  }});
  vm.runInContext(await source('tool-registration.js'),api);
  const saved=await api.window.ToolRegistration.correctPersonalIdentity({p_tool_id:42,p_group:'充電工具',p_name:'充電ドライバー',p_lathe_size:null});
  assert.equal(saved.id,42);
  assert.ok(requests[0][0].endsWith('/rpc/correct_personal_tool_identity'));
  assert.equal(requests[0][1].method,'POST');
}
const migration=await source('supabase/add_personal_tool_identity_correction.sql');
const fixture=await source('tests/personal-tool-identity-db.test.sql');
assert.ok(fixture.includes(migration.replace(/^begin;$/m,'').replace(/^commit;$/m,'')), 'DB fixture must use current production definitions');
const normal=await source('supabase/add_personal_tool_update.sql');
assert.ok(migration.includes(normal.slice(normal.indexOf('create or replace function'),normal.indexOf('notify pgrst'))),'normal RPC must match incremental migration');
console.log('PASS: correction API object/array responses; DB fixture and deployed RPC definitions match (SQL execution is separate)');

await editor.edit(own);
get('personalToolCorrectIdentity').events.click();
form.elements.toolName.value='複数区分の工具';form.elements.toolName.events.change();
assert.equal(form.elements.group.value,'');
assert.equal(save.disabled,true);
assert.match(get('personalToolIdentityHint').textContent,/特定できません.*管理者/);
const correctionCount=correctionCalls.length;
await form.events.submit({preventDefault(){}});
assert.equal(correctionCalls.length,correctionCount);
form.elements.toolName.value='充電インパクト';form.elements.toolName.events.change();
assert.equal(form.elements.group.value,'充電工具');
assert.equal(save.disabled,false);
console.log('PASS: name-only selection sets group, ambiguous names fail closed, correction copy, legacy error normalization, contractor denial, registration group restored');
