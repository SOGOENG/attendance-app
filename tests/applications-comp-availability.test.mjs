import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const elements=new Map();
const get=id=>{if(!elements.has(id))elements.set(id,{textContent:'',innerHTML:''});return elements.get(id);};
const calls=[];
const context=vm.createContext({PORTAL_SUPABASE_URL:'https://test.invalid',window:{},Date,Number,Map,
  document:{getElementById:get,querySelectorAll:()=>[],createElement:()=>({textContent:'',innerHTML:''})},
  portalFetch:async(url,options)=>{
    calls.push({url,options});
    const data=url.includes('paid_leave_balances')?[{remaining_days:8}]:[
      {id:1,work_date:'2026-07-01',remaining_days:1,reserved_days:1,available_days:0},
      {id:2,work_date:'2026-07-02',remaining_days:1,reserved_days:.5,available_days:.5}
    ];
    return {ok:true,text:async()=>JSON.stringify(data)};
  }
});
let source=await readFile(new URL('../applications.js',import.meta.url),'utf8');
source=source.slice(0,source.lastIndexOf('init().catch'))+'user={id:7}; window.loadBalances=loadBalances;})();';
vm.runInContext(source,context);
await context.window.loadBalances();
assert.equal(get('paidBalance').textContent,8);
assert.equal(get('compBalance').textContent,'0.5');
assert.doesNotMatch(get('workAllocations').innerHTML,/data-record="1"/);
assert.match(get('workAllocations').innerHTML,/data-record="2" data-max="0.5"/);
assert.match(get('workAllocations').innerHTML,/option value="0.5"/);
assert.doesNotMatch(get('workAllocations').innerHTML,/option value="1"/);
assert.ok(calls.some(c=>c.url.endsWith('/rpc/get_comp_leave_availability') && JSON.parse(c.options.body).p_employee_id===7));
assert.ok(calls.every(c=>!c.url.includes('comp_leave_allocations')&&!c.url.includes('holiday_work_records')));
console.log('PASS: normal application uses authorized availability RPC, excludes reserved candidates, limits partial balance and preserves paid balance');
