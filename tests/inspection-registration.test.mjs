import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const code=await readFile(new URL('../tool-inspection-registration.js',import.meta.url),'utf8');
class Element {
  constructor(){this.value='';this.checked=false;this.children=[];this.events={};this.disabled=false;}
  addEventListener(name,fn){this.events[name]=fn;}
  replaceChildren(...items){this.children=items;this.value='';}
  add(item){this.children.push(item);}
  appendChild(item){this.children.push(item);}
  reportValidity(){return true;}
}
const nodes=new Map();const get=id=>{if(!nodes.has(id))nodes.set(id,new Element());return nodes.get(id);};
const form=get('inspectionNewToolForm');
form.elements=Object.fromEntries(['ownership','employee','company','group','toolName','newName','prefix','masterRequired','masterCategory','masterActive','sortOrder','latheSize','inspectionRequired','category','note','initialPurchase'].map(name=>[name,new Element()]));
const f=form.elements;
let catalog=[{tool_group:'その他',tool_name:'既存工具',code_prefix:'EX',inspection_required:true,inspection_category:'3p',active:true}];
const posts=[],registrations=[],storage=new Map(),stored=new Map();let lostResponse=true,created=0;
const context=vm.createContext({document:{getElementById:get,createElement:()=>new Element()},
  window:{inspectionListReady:Promise.resolve(),TOOL_GROUPS:['その他'],confirm:()=>true},
  currentCycle:{id:2,status:'completed'},crypto:{randomUUID:()=> '00000000-0000-0000-0000-000000000123'},
  Option:function(text,value){this.text=text;this.value=value;},
  sessionStorage:{getItem:key=>storage.get(key),setItem:(key,val)=>storage.set(key,val),removeItem:key=>storage.delete(key)},
  ToolRegistration:{loadMasterCatalog:async()=>catalog,request:async(path,options)=>{
    posts.push({path,options});catalog=[...catalog,JSON.parse(options.body)];return null;
  }},
  ToolInspectionWorkflow:{refreshLatestCompleted:async()=>{},canAddToCycle:cycle=>cycle.status==='active'||cycle.id===2,requireAdmin:async()=>true,rows:async()=>[{id:9,name:'社員'}],
    register:async(cycle,record,size,request,purchase)=>{
      registrations.push({cycle,record,size,request,purchase});
      if(!stored.has(request)){created++;stored.set(request,{id:99,tool_name:record.tool_name,management_code:'EX-021'});}
      if(lostResponse){lostResponse=false;throw new Error('response lost');}
      return stored.get(request);
    }},refreshInspectionData:async()=>{}});
await vm.runInContext(code,context);
f.ownership.value='personal';f.employee.value='9';f.group.value='その他';f.group.events.change();
f.toolName.value='既存工具';f.toolName.events.change();
assert.equal(f.category.value,'3p');assert.equal(f.inspectionRequired.checked,true);
f.initialPurchase.checked=false;
await form.events.submit({preventDefault(){}});
assert.equal(registrations.length,0,'completed cycle requires purchase confirmation');
f.initialPurchase.checked=true;
await form.events.submit({preventDefault(){}});
assert.equal(created,1);assert.equal(get('inspectionNewToolFields').disabled,true);
await form.events.submit({preventDefault(){}});
assert.equal(registrations.length,2);assert.equal(created,1);
assert.equal(registrations[0].request,registrations[1].request);
assert.equal(registrations[0].record.assigned_employee_id,9);
assert.equal(posts.length,0,'existing name never creates a master row');
assert.equal(storage.size,0);
assert.match(get('inspectionRegistrationLinks').children[0].href,/cycle=2&tool=99/);
assert.equal(get('inspectionRegistrationLinks').children[1].href,'tool-qr.html');
console.log('PASS: existing catalog reuse, completed-cycle confirmation, retry idempotency, inspection and QR links');

f.newName.value='既存工具';f.prefix.value='EX';f.sortOrder.value='0';
await get('inspectionMasterSave').events.click();assert.equal(posts.length,0);
f.newName.value='新名称';f.prefix.value='NEW';f.masterRequired.checked=true;f.masterCategory.value='double_insulated';f.masterActive.checked=true;
await get('inspectionMasterSave').events.click();
assert.equal(posts.length,1);assert.equal(posts[0].path,'tool_catalog');
assert.equal(JSON.parse(posts[0].options.body).code_prefix,'NEW');
assert.equal(f.toolName.value,'新名称');assert.equal(f.category.value,'double_insulated');
console.log('PASS: explicit new-master registration, duplicate-name prevention and defaults');

context.currentCycle={id:1,status:'completed'};
get('inspectionRegistration').textContent='';
await vm.runInContext(code,context);
assert.match(get('inspectionRegistration').textContent,/直近/);
assert.equal(registrations.length,2,'old completed cycle cannot register');
console.log('PASS: old completed cycle has no registration form');
