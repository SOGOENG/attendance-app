import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const read=name=>readFile(new URL(`../${name}`,import.meta.url),'utf8');
const controls=new Map();
function get(id){if(!controls.has(id))controls.set(id,{value:'',disabled:false,textContent:'',innerHTML:'',events:{},
  addEventListener(event,fn){this.events[event]=fn;},replaceChildren(){this.innerHTML='';}});return controls.get(id);}
const form=get('adminPaidUsageForm');
form.elements=['adminPaidUsageDate','adminPaidUsageDays','adminPaidUsageNote','adminPaidUsageSubmit'].map(get);
form.reportValidity=()=>true;
let allowed=true, remaining=5, writes=[], failure=false, refreshes=0, requests=[];
const context=vm.createContext({window:{},document:{getElementById:get},Date,Number,JSON,
  crypto:{randomUUID:()=>`request-${writes.length}`}});
vm.runInContext(await read('admin-paid-usage.js'),context);
const controller=context.window.createAdminPaidUsage({
  allowed:()=>allowed,escapeHtml:s=>s,employeeName:id=>`社員${id}`,
  req:async path=>{requests.push(path);return [{remaining_days:remaining}];},
  rpc:async (name,body)=>{
    if(name==='admin_paid_leave_usage_history')return [];
    writes.push(body);if(failure)throw Error('通信エラー');remaining-=body.p_days;
  },refreshBalances:async()=>{refreshes++;await controller.refresh(7);}
});
get('adminPaidUsageDate').value='2026-03-31';
await controller.refresh(7);
assert.match(requests.at(-1),/fiscal_year=eq.2025/);
get('adminPaidUsageDate').value='2026-04-01';
await get('adminPaidUsageDate').events.change();
assert.match(requests.at(-1),/fiscal_year=eq.2026/);
const submit=()=>form.events.submit({preventDefault(){}});
for(const value of ['0','-1','6']){get('adminPaidUsageDays').value=value;await submit();assert.equal(writes.length,0);}
allowed=false;get('adminPaidUsageDays').value='1';await submit();assert.equal(writes.length,0);
allowed=true;get('adminPaidUsageDays').value='1.5';get('adminPaidUsageNote').value=' 備考 ';
failure=true;await submit();const retryId=writes.at(-1).p_request_id;
failure=false;await submit();assert.equal(writes.at(-1).p_request_id,retryId);
assert.equal(writes.at(-1).p_note,'備考');assert.equal(refreshes,1);
assert.match(get('adminPaidUsageBalance').textContent,/3.5日/);
assert.match(get('adminPaidUsageMessage').textContent,/登録しました/);
controller.clear();assert.equal(get('adminPaidUsageSubmit').disabled,true);
assert.equal(get('adminPaidUsageHistory').innerHTML,'');
for(const file of ['applications-admin.js','admin-paid-usage.js'])new vm.Script(await read(file));
console.log('PASS: fiscal boundary, zero/negative/overdraft, authorization, retry UUID, refresh balance, clear, syntax');
