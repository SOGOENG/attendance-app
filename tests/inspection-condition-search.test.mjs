import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const code = (await readFile(new URL('../tool-inspection-list.js', import.meta.url), 'utf8')).replaceAll('\r\n', '\n');
const html = await readFile(new URL('../tool-inspection-list.html', import.meta.url), 'utf8');
class Select {
  constructor(value = '') { this.value = value; this.children = []; this.disabled = false; }
  set innerHTML(value) { this.children = []; this.value = ''; }
  appendChild(option) { this.children.push(option); }
}
const group = new Select(), name = new Select(), employee = new Select(), ownership = new Select(), contractor = new Select();
const result = {classList:{add(){},remove(){}},scrollIntoView(){}};
const tools = [
  {id:1, ownership_type:'shared', tool_group:'電動', tool_name:'ドリル'},
  {id:2, ownership_type:'personal', assigned_employee_id:7, tool_group:'電動', tool_name:'ドリル'},
  {id:3, ownership_type:'personal', assigned_employee_id:7, tool_group:'手動', tool_name:'レンチ'},
  {id:4, ownership_type:'personal', assigned_employee_id:8, tool_group:'電動', tool_name:'ドリル'},
  {id:5, ownership_type:'contractor', owner_company_name:'会社Ａ', tool_group:'手動', tool_name:'レンチ'},
  {id:6, ownership_type:'contractor', owner_company_name:'会社Ａ', tool_group:'電動', tool_name:'ドリル'},
  {id:7, ownership_type:'contractor', owner_company_name:'会社Ｂ', tool_group:'電動', tool_name:'ドリル'},
  {id:8, ownership_type:'contractor', owner_company_name:null, tool_group:'手動', tool_name:'レンチ'}
];
const c = vm.createContext({document:{createElement:()=>({})},
  inspectionGroupFilter:group, inspectionToolNameFilter:name, inspectionEmployeeFilter:employee,
  inspectionOwnershipFilter:ownership, inspectionSearchEmployeeLabel:{hidden:true},
  inspectionContractorFilter:contractor, inspectionSearchContractorLabel:{hidden:true},
  inspectionStatusFilter:{value:''}, inspectionTools:tools, inspectedToolIdSet:new Set([2,5]),
  employeeNameMap:new Map([[7,'社員Ａ'],[8,'社員Ｂ']]), TOOL_GROUP_ORDER:['電動','手動'],
  sortToolGroups:groups=>groups, getToolGroup:tool=>tool.tool_group,
  inspectionToolResultSection:result, inspectionToolResultTitle:{}, inspectionToolResultCount:{},
  displayInspectionTools:rows=>{c.shown=rows.map(row=>row.id);}});
vm.runInContext(code.slice(code.indexOf('function buildGroupFilter()'), code.indexOf('async function refreshInspectionData()')), c);
vm.runInContext(code.slice(code.indexOf('function renderInspectionSearch()'), code.indexOf('function displayInspectionTools(')), c);
const search = (owner='', user='', category='', tool='', status='', company='') => {
  ownership.value=owner; employee.value=user; group.value=category; name.value=tool;
  contractor.value=company;
  c.inspectionStatusFilter.value=status; c.renderInspectionSearch(); return Array.from(c.shown);
};
assert.deepEqual(search(), [1,2,3,4,5,6,7,8]);
assert.deepEqual(search('shared'), [1]);
assert.deepEqual(search('personal'), [2,3,4]);
assert.deepEqual(search('contractor'), [5,6,7,8]);
assert.deepEqual(search('contractor','','','','','会社Ａ'), [5,6]);
assert.deepEqual(search('contractor','','電動','ドリル','pending','会社Ａ'), [6]);
assert.deepEqual(search('contractor','','電動','ドリル','completed','会社Ａ'), []);
assert.deepEqual(search('shared','','','','','会社Ａ'), [1]);
assert.deepEqual(search('personal','7'), [2,3]);
assert.deepEqual(search('personal','7','電動','ドリル','completed'), [2]);
assert.deepEqual(search('personal','7','電動','ドリル','pending'), []);
assert.deepEqual(search('','','','','pending'), [1,3,4,6,7,8]);
assert.deepEqual(search('','','手動'), [3,5,8]);
c.buildInspectionContractorFilter();
assert.deepEqual(contractor.children.map(x=>x.value), ['会社Ａ','会社Ｂ']);
ownership.value='contractor'; contractor.value='会社Ａ'; c.updateInspectionOwnershipFilter();
assert.equal(c.inspectionSearchContractorLabel.hidden, false);
assert.equal(c.inspectionSearchEmployeeLabel.hidden, true);
c.buildInspectionContractorFilter(); assert.equal(contractor.value,'会社Ａ');
ownership.value='personal'; c.updateInspectionOwnershipFilter();
assert.equal(c.inspectionSearchContractorLabel.hidden, true); assert.equal(contractor.value,'');
ownership.value='contractor'; contractor.value='会社Ｂ';
const removed = tools.splice(6,1)[0]; c.buildInspectionContractorFilter(); assert.equal(contractor.value,'');
tools.splice(6,0,removed);
c.buildInspectionEmployeeFilter();
assert.deepEqual(employee.children.map(x=>x.value), ['7','8']);
ownership.value='personal'; employee.value='7'; c.updateInspectionOwnershipFilter();
assert.equal(c.inspectionSearchEmployeeLabel.hidden, false);
ownership.value='shared'; c.updateInspectionOwnershipFilter();
assert.equal(c.inspectionSearchEmployeeLabel.hidden, true); assert.equal(employee.value,'');
group.value='電動'; name.value='ドリル'; c.updateToolNameFilter(); assert.equal(name.value,'ドリル');
group.value='手動'; c.updateToolNameFilter(); assert.equal(name.value,'');
group.value=''; c.updateToolNameFilter(); assert.equal(name.value,''); assert.equal(name.disabled,true);
group.value='電動'; name.value='ドリル'; employee.value='7';
c.buildGroupFilter(); c.updateToolNameFilter(); c.buildInspectionEmployeeFilter();
assert.equal(group.value,'電動'); assert.equal(name.value,'ドリル'); assert.equal(employee.value,'7');
// Exercise the real refresh sequence for both cycle types, including retained
// and removed choices after the target tool data changes.
c.inspectionRefreshPromise=null;
c.loadCycle=async()=>{}; c.loadInspectionRecords=async()=>{}; c.loadEmployees=async()=>{};
c.updateProgress=()=>{}; c.updateCsvTargetCount=()=>{};
let cycleStatus='active';
c.loadInspectionTools=async()=>{
  c.inspectionTools=cycleStatus==='active' ? tools : tools.filter(t=>[5,7].includes(t.id));
};
vm.runInContext(code.slice(code.indexOf('async function refreshInspectionData()'), code.indexOf('async function searchInspectionTools()')), c);
ownership.value='contractor'; contractor.value='会社Ａ';
await c.refreshInspectionData(); assert.equal(contractor.value,'会社Ａ');
cycleStatus='completed'; await c.refreshInspectionData();
assert.equal(contractor.value,'会社Ａ'); c.renderInspectionSearch(); assert.deepEqual(Array.from(c.shown), []);
group.value=''; name.value=''; c.renderInspectionSearch(); assert.deepEqual(Array.from(c.shown), [5]);
contractor.value='会社Ｂ'; await c.refreshInspectionData(); assert.equal(contractor.value,'会社Ｂ');
cycleStatus='active'; tools.splice(6,1); await c.refreshInspectionData(); assert.equal(contractor.value,'');
assert.ok(html.indexOf('inspectionOwnershipFilter') < html.indexOf('inspectionEmployeeFilter'));
assert.ok(html.indexOf('inspectionEmployeeFilter') < html.indexOf('inspectionGroupFilter'));
assert.match(html, /#inspectionSearchEmployeeLabel\[hidden\]/);
assert.match(html, /#inspectionSearchContractorLabel\[hidden\]/);
assert.ok(html.indexOf('inspectionContractorFilter') < html.indexOf('inspectionGroupFilter'));
assert.match(html, /tool-inspection-list\.js\?v=20/);
console.log('PASS: ownership, employee, combined and all/pending searches, selection resets and refresh preservation');
