import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const read=name=>readFile(new URL(`../${name}`,import.meta.url),'utf8');
const elements=new Map();
function get(id){if(!elements.has(id))elements.set(id,{value:'',disabled:false,hidden:true,textContent:'',innerHTML:'',events:{},
  addEventListener(event,fn){this.events[event]=fn;},replaceChildren(){this.innerHTML='';}});return elements.get(id);}
const panel=get('adminCompUsage');panel.querySelector=selector=>get(selector.slice(1));
const form=get('adminCompUsageForm');form.elements=['adminCompUsageDate','adminCompUsageDays','adminCompUsageNote','adminCompUsageSubmit'].map(get);form.reportValidity=()=>true;
let allowed=true,fail=false,refreshes=0,writes=[],mounts=0,available=2,balanceFail=false;
const ctx=vm.createContext({window:{},document:{getElementById:get,querySelector:()=>({insertAdjacentElement(position,node){assert.equal(position,'afterend');assert.equal(node,panel);mounts++;}})},Date,Number,JSON,crypto:{randomUUID:()=>`uuid-${writes.length}`}});
vm.runInContext(await read('admin-comp-usage.js'),ctx);
const controller=ctx.window.createAdminCompUsage({allowed:()=>allowed,escapeHtml:s=>s,employeeName:id=>`社員${id}`,
  rpc:async(name,body)=>{if(name==='admin_comp_leave_usage_history')return [];if(name==='get_comp_leave_availability'){if(balanceFail)throw Error('残数取得エラー');return [{available_days:available}];}writes.push(body);if(fail)throw Error('通信エラー');return 10;},
  refreshWork:async()=>{refreshes++;available=.5;await controller.refresh(7,[{status:'active',remaining_days:1}]);}
});
await controller.refresh(7,[{status:'active',remaining_days:'1'},{status:'active',remaining_days:'1'},{status:'cancelled',remaining_days:99}]);
assert.equal(panel.hidden,false);assert.equal(mounts,1);
const submit=()=>form.events.submit({preventDefault(){}});
for(const days of ['0','-1','3']){get('adminCompUsageDays').value=days;await submit();assert.equal(writes.length,0);}
allowed=false;get('adminCompUsageDays').value='1.5';await submit();assert.equal(writes.length,0);allowed=true;
get('adminCompUsageDate').value='2026-08-01';get('adminCompUsageNote').value=' 備考 ';
fail=true;await submit();const requestId=writes.at(-1).p_request_id;
fail=false;await submit();assert.equal(writes.at(-1).p_request_id,requestId);assert.equal(writes.at(-1).p_days,1.5);
assert.equal(writes.at(-1).p_note,'備考');assert.equal(refreshes,1);assert.match(get('adminCompUsageMessage').textContent,/登録しました/);
get('adminCompUsageDays').value='1';await submit();assert.equal(writes.length,2,'refreshed remaining blocks overuse');
assert.equal(get('adminCompUsageDays').max,'0.5','RPC availability controls max rather than raw remaining');
available=0;await controller.refresh(7,[{status:'active',remaining_days:10}]);
assert.equal(get('adminCompUsageSubmit').disabled,true,'fully reserved disables submission');
get('adminCompUsageDays').value='.5';await submit();assert.equal(writes.length,2);
balanceFail=true;await controller.refresh(7,[{status:'active',remaining_days:10}]);
assert.equal(get('adminCompUsageSubmit').disabled,true,'failed availability does not fall back to raw remaining');
await submit();assert.equal(writes.length,2);
controller.clear();assert.equal(panel.hidden,true);assert.equal(get('adminCompUsageSubmit').disabled,true);
for(const name of ['applications.js','applications-admin.js','admin-comp-usage.js','admin-paid-usage.js'])new vm.Script(await read(name));
console.log('PASS: summary placement, cancelled exclusion, positive/remaining validation, authorization, retry, refresh, clear, syntax');
