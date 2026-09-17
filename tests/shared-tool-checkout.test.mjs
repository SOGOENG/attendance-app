import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
const source = await readFile(new URL('../tool-checkout.js',import.meta.url),'utf8');
const state = await readFile(new URL('../shared-tool-state.js',import.meta.url),'utf8');
for (const adminScope of ['none','all','tool_admin']) {
  const elements=new Map(); let employeeLoads=0;
  const element=id=>{
    if(!elements.has(id)) elements.set(id,{disabled:false,children:[],addEventListener(){},replaceChildren(){this.children=[]},appendChild(x){this.children.push(x)}});
    return elements.get(id);
  };
  const ctx=vm.createContext({document:{getElementById:element,createElement:()=>({})},
    localStorage:{getItem:()=>JSON.stringify({id:12,name:'本人',adminScope})},
    ToolEmployeeSelector:{loadEmployees:async()=>{employeeLoads++}},console});
  vm.runInContext(source.replace(/initialize\(\);\s*$/,''),ctx);
  vm.runInContext("currentTool={ownership_type:'shared'}",ctx);
  await ctx.loadEmployees();
  assert.equal(employeeLoads,adminScope==='none'?0:1);
  assert.equal(element('checkoutEmployee').disabled,adminScope==='none');
  if(adminScope==='none') assert.equal(element('checkoutEmployee').value,'12');
  console.log(`PASS: assignee selector for ${adminScope}`);
}
for (const scenario of ['success','rpc-error','non-json-error','network-error','empty-response','wrong-tool','duplicate']) {
  const elements = new Map(), calls=[],alerts=[];
  const element = id => {
    if (!elements.has(id)) elements.set(id,{value:'',textContent:'',disabled:false,addEventListener(){}});
    return elements.get(id);
  };
  let release;
  const pending=new Promise(r=>{release=r});
  const context=vm.createContext({document:{getElementById:element},window:{confirm:()=>true,location:{}},console:{error(){}},
    alert:m=>alerts.push(m),portalFetch:async(url,options)=>{
      calls.push({url,options});
      if(scenario==='duplicate') await pending;
      if(scenario==='network-error') throw Error('offline');
      return {ok:!['rpc-error','non-json-error'].includes(scenario),json:async()=>{
        if(scenario==='non-json-error') throw Error('bad json');
        if(scenario==='rpc-error') return {message:'履歴保存失敗'};
        if(scenario==='empty-response') return null;
        return {id:scenario==='wrong-tool'?999:295,current_site_id:9,assigned_employee_id:12,status:'in_use',updated_at:'2026-09-17'};
      }};
    }});
  vm.runInContext(state,context);
  vm.runInContext(source.replace(/initialize\(\);\s*$/,''),context);
  vm.runInContext("currentTool={id:295,ownership_type:'shared',active:true,checkout_managed:true,current_site_id:null,status:'available'}",context);
  element('checkoutSite').value='9'; element('checkoutEmployee').value='12'; element('checkoutNote').value=' note ';
  const first=context.checkoutTool();
  if(scenario==='duplicate') { await context.checkoutTool(); assert.equal(calls.length,1); release(); }
  await first;
  assert.equal(calls.length,1); assert.ok(calls[0].url.endsWith('/rpc/checkout_shared_tool'));
  assert.equal(calls[0].options.method,'POST');
  assert.deepEqual(JSON.parse(calls[0].options.body),{p_tool_id:295,p_site_id:9,p_employee_id:12,p_note:'note'});
  const success=['success','duplicate'].includes(scenario);
  assert.equal(alerts.length,success?1:0);
  assert.equal(context.window.location.href,success?'shared-tools.html':undefined);
  assert.equal(element('checkoutButton').disabled,false);
  if(!success) assert.ok(element('checkoutMessage').textContent);
  console.log(`PASS: checkout ${scenario}`);
}
