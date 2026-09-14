import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const source = async file => (await readFile(new URL('../'+file,import.meta.url),'utf8')).replaceAll('\r\n','\n');
const calls=[];
const context=vm.createContext({window:{},ToolRegistration:{request:async(path,options)=>{
  calls.push({path,options}); return path.startsWith('rpc/is_') ? true : path === 'rpc/latest_completed_tool_inspection_cycle_id' ? 2 : [];
}}});
vm.runInContext(await source('tool-inspection-workflow.js'),context);
const workflow=context.window.ToolInspectionWorkflow;
await Promise.all([workflow.requireAdmin(),workflow.requireAdmin()]);
assert.equal(calls.length,1,'one shared administrator check');
await workflow.refreshLatestCompleted();
assert.equal(workflow.canAddToCycle({id:1,status:'completed'}),false);
assert.equal(workflow.canAddToCycle({id:2,status:'completed'}),true);
assert.equal(workflow.canAddToCycle({id:3,status:'active'}),true);
const tool={id:7,inspection_required:true,status:'available'};
assert.equal(workflow.canInspect({status:'active'},tool,[],[]),true);
assert.equal(workflow.canInspect({status:'active'},tool,[],[{tool_id:7}]),false);
assert.equal(workflow.canInspect({id:2,status:'completed'},tool,[],[]),false);
assert.equal(workflow.canInspect({id:2,status:'completed'},tool,[{tool_id:7,initial_purchase:true,consumed_at:null}],[]),true);
assert.equal(workflow.canInspect({id:2,status:'completed'},tool,[{tool_id:7,initial_purchase:true,consumed_at:'done'}],[]),false);
assert.equal(workflow.canInspect({id:1,status:'completed'},tool,[{tool_id:7,initial_purchase:true}],[]),false);
assert.equal(workflow.canInspect({status:'preparing'},tool,[],[]),false);
assert.equal(workflow.canInspect({status:'active'},{...tool,inspection_required:false},[],[]),false);
assert.equal(workflow.calendarYear({cycle_name:'2026年12月点検',created_at:'2027-01-01'}),2026);
assert.equal(workflow.calendarYear({cycle_name:'2027年6月点検'}),2027);
context.ToolRegistration.request=async()=>3;
await workflow.refreshLatestCompleted();
assert.equal(workflow.canInspect({id:2,status:'completed'},tool,[{tool_id:7,initial_purchase:true}],[]),false,'new completion blocks the previously latest cycle');
context.ToolRegistration.request=async()=>{throw new Error('offline');};
await assert.rejects(()=>workflow.refreshLatestCompleted(),/offline/);
assert.equal(workflow.canAddToCycle({id:3,status:'completed'}),false,'failed refresh must not retain permission');
assert.equal(workflow.canAddToCycle({id:1,status:'active'}),true);
console.log('PASS: shared authority, calendar year, latest completed, changed latest, fail-closed and active eligibility');

class Element {
  constructor(){this.value='';this.children=[];this.textContent='';this.events={};this.hidden=false;
    const classes=new Set();this.classList={add:x=>classes.add(x),remove:x=>classes.delete(x),contains:x=>classes.has(x)};}
  addEventListener(name,fn){this.events[name]=fn;}
  replaceChildren(...items){this.children=items;}
  add(item){this.children.push(item);}
  appendChild(item){this.children.push(item);}
  scrollIntoView(){}
  set innerHTML(value){this._html=value;this.children=[];}
  get innerHTML(){return this._html;}
}
const elements=new Map();const element=id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id);};
const top=await source('tool-inspection.js');
const topContext=vm.createContext({document:{getElementById:element,createElement:()=>new Element()},
  Option:function(text,value){this.text=text;this.value=value;},Date,ToolInspectionWorkflow:workflow,
  inspectionCycleList:element('active'),escapeHtml:x=>String(x)});
vm.runInContext(top.slice(top.indexOf('let loadedCycles'),top.indexOf('async function initializeInspectionHome')),topContext);
const year=new Date().getFullYear();
vm.runInContext(`displayInspectionCycles([
 {id:1,status:'active',cycle_name:'${year-1}年12月点検'},
 {id:2,status:'completed',cycle_name:'${year}年6月点検'},
 {id:3,status:'completed',cycle_name:'${year-1}年12月点検'}]);`,topContext);
assert.equal(element('active').children.length,1);
assert.equal(element('inspectionHistoryYear').value,String(year));
assert.equal(element('inspectionHistoryList').children.length,1);
assert.match(element('inspectionHistoryList').children[0].innerHTML,new RegExp(`${year}年6月`));
element('inspectionHistoryYear').value=String(year-1);
element('inspectionHistoryYear').events.change();
assert.match(element('inspectionHistoryList').children[0].innerHTML,new RegExp(`${year-1}年12月`));
console.log('PASS: in-progress separated from completed, current-year default and year switching');

const list=await source('tool-inspection-list.js');
const searchContext=vm.createContext({document:{getElementById:element},
  refreshInspectionData:async()=>{},ToolRegistration:{loadTools:async query=>{calls.push(query);return [{id:7,management_code:'HT-010'}];}},
  inspectionToolResultTitle:element('title'),inspectionToolResultCount:element('count'),
  inspectionToolResultSection:element('results'),displayInspectionTools:rows=>{searchContext.shown=rows;}});
element('inspectionCodeInput').value=' HT-010 ';
vm.runInContext(list.slice(list.indexOf('async function searchInspectionCode'),list.indexOf('async function refreshVisibleInspection')),searchContext);
await searchContext.searchInspectionCode({preventDefault(){}});
assert.equal(calls.at(-1),'select=*&management_code=eq.HT-010');
assert.equal(searchContext.shown[0].id,7);
console.log('PASS: exact management-code search and existing result rendering');

let databaseRecords=[];
const pendingContext=vm.createContext({inspectionRefreshPromise:null,activeInspectionSearch:null,
  inspectionGroupFilter:{value:'その他'},inspectionToolNameFilter:{value:'工具'},inspectionStatusFilter:{value:'pending'},
  inspectionTools:[{id:7,tool_group:'その他',tool_name:'工具'}],inspectedToolIdSet:new Set(),
  inspectionToolResultTitle:element('pendingTitle'),inspectionToolResultCount:element('pendingCount'),
  inspectionToolResultSection:element('pendingResults'),inspectionListMessage:element('pendingMessage'),
  loadCycle:async()=>{},loadInspectionTools:async()=>{},loadInspectionRecords:async()=>{
    pendingContext.inspectedToolIdSet.clear();databaseRecords.forEach(r=>pendingContext.inspectedToolIdSet.add(r.tool_id));
  },updateProgress(){},updateCsvTargetCount(){},getToolGroup:t=>t.tool_group,
  displayInspectionTools:rows=>{pendingContext.shown=rows;},alert(){}});
vm.runInContext(list.slice(list.indexOf('async function refreshInspectionData'),list.indexOf('function displayInspectionTools')),pendingContext);
await pendingContext.searchInspectionTools();assert.equal(pendingContext.shown.length,1);
databaseRecords=[{tool_id:7}];
await pendingContext.searchInspectionTools();assert.equal(pendingContext.shown.length,0);
assert.equal(pendingContext.inspectionStatusFilter.value,'pending');
console.log('PASS: a second inspector refreshes pending results from current DB state without losing filters');

const entry=await source('tool-inspection-entry.js');
let release;const gate=new Promise(resolve=>{release=resolve;});const writes=[];
const entryContext=vm.createContext({savingInspection:false,inspectionEntryReady:true,
  inspectionEntryMessage:element('entryMessage'),saveInspectionButton:element('save'),
  currentTool:{id:7,tool_name:'工具'},currentCycle:{id:2,cycle_code:'2026-06'},
  inspectionDate:{value:'2026-09-15'},inspectionStickerNumber:{value:'101'},inspectionResult:{value:'ok'},
  inspectionDefectDetail:{value:''},inspectionCorrectiveAction:{value:''},inspectionNote:{value:''},inspectionStickerConfirmed:{checked:true},
  validateInspection(){},checkEntryEligibility:async()=>{await gate;return true;},getLoginUser:()=>({id:9}),getChecklistResults:()=>({'1':{checked:true}}),
  SUPABASE_URL:'https://test.invalid',portalFetch:async(path,options)=>{writes.push({path,options});return {ok:true};},
  window:{confirm:()=>true,location:{}},alert(){},console});
vm.runInContext(entry.slice(entry.indexOf('async function saveInspection()'),entry.indexOf('/* =========================================\n   イベント')),entryContext);
const first=entryContext.saveInspection();await entryContext.saveInspection();release();await first;
assert.equal(writes.length,1);assert.equal(writes[0].options.method,'POST');
assert.match(writes[0].path,/tool_inspections$/);assert.equal(entryContext.inspectionEntryReady,false);
assert.equal(JSON.parse(writes[0].options.body).sticker_number,'101');
console.log('PASS: duplicate-submit guard, existing inspection INSERT only, no independent counter PATCH');

for(const file of ['tool-inspection.html','tool-inspection-list.html']) {
  const html=await source(file);
  const opens=[...html.matchAll(/<details\b([^>]*)>/g)].filter(m=>/\bopen\b/.test(m[1]));
  assert.equal(opens.length,1);
  assert.equal([...html.matchAll(/<details\b/g)].length,[...html.matchAll(/<\/details>/g)].length);
  const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);assert.equal(ids.length,new Set(ids).size);
}
const init=entry.slice(entry.indexOf('async function initialize()'));
assert.match(init,/inspectionEntryReady = await checkEntryEligibility\(\)/);
const migration=await source('supabase/inspection_initial_additions.sql');
const fixture=await source('tests/inspection-initial-additions.test.sql');
assert.ok(fixture.includes(migration.replace(/^begin;$/m,'').replace(/^commit;$/m,'')), 'DB fixture uses current production migration');
for(const file of ['tool-inspection.js','tool-inspection-list.js','tool-inspection-entry.js','tool-inspection-workflow.js','tool-inspection-registration.js','service-worker.js'])new vm.Script(await source(file));
console.log('PASS: accordion defaults, unique IDs, entry eligibility initialization and syntax');
