import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const source=await readFile(new URL('../applications-admin.js',import.meta.url),'utf8');
const html=await readFile(new URL('../applications-admin.html',import.meta.url),'utf8');
const elements=new Map();
const $=id=>{if(!elements.has(id))elements.set(id,{value:'',innerHTML:'',textContent:'',disabled:false});return elements.get(id);};
const groups=Array.from({length:4},()=>({disabled:true}));
const calls=[];
let allowed=true;
const context=vm.createContext({$,Date,document:{querySelectorAll:()=>groups},
  isLeaveManager:()=>allowed, emp:id=>`社員${id}`,
  filterEmployeeOptions:prefix=>{$(prefix+'Employee').innerHTML=`options:${$(prefix+'Department').value}`;$(prefix+'Employee').value='';},
  clearWorkHistory:()=>calls.push('clearWork'),clearBalanceHistory:()=>calls.push('clearBalance'),
  clearCompExpirationHistory:()=>{},loadCompExpirationHistory:async()=>{},
  historyPrompt:()=>'<p>対象社員を選択してください</p>',
  loadWork:async()=>calls.push(`work:${$('workEmployee').value}`),
  loadBalances:async()=>calls.push(`paid:${$('balanceEmployee').value}`),
  handleWorkHistoryError:()=>assert.fail('unexpected work error'),
  handleBalanceHistoryError:()=>assert.fail('unexpected paid error'),
  // These global list functions must never be called by personal employee selection.
  loadPending:()=>assert.fail('global pending list accessed'),
  loadApprovedHistory:()=>assert.fail('global approved list accessed')
});
$('workForm').reset=()=>{$('workDepartment').value='';$('workEmployee').value='';};
$('balanceForm').reset=()=>{$('balanceDepartment').value='';$('balanceEmployee').value='';$('grantedDays').value='';};
vm.runInContext(source.slice(source.indexOf('function resetWork()')).split('\n')[0],context);
const start=source.indexOf('function initializePersonalEmployee()');
vm.runInContext(source.slice(start,source.indexOf('initializeApprovedFilters();',start)),context);
$('workDepartment').innerHTML='departments';
context.initializePersonalEmployee();
assert.equal($('personalDepartment').innerHTML,'departments');
assert.equal($('personalEmployee').disabled,true);
$('personalDepartment').value='営業';
$('personalDepartment').onchange();
assert.equal($('personalEmployee').innerHTML,'options:営業');
assert.ok(groups.every(g=>g.disabled));
calls.length=0;
$('personalEmployee').value='7';
$('workRecordId').value='old-record';
$('grantedDays').value='old-employee-input';
await $('personalEmployee').onchange();
assert.equal($('workRecordId').value,'');
assert.equal($('grantedDays').value,'');
for(const prefix of ['work','balance']) {
  assert.equal($(prefix+'Department').value,'営業');
  assert.equal($(prefix+'Employee').value,'7');
}
assert.deepEqual(calls,['clearWork','clearBalance','work:7','paid:7']);
assert.ok(groups.every(g=>!g.disabled));
context.resetWork();
assert.equal($('workEmployee').value,'7','clearing/saving work form retains shared employee');
$('personalEmployee').value='8';
await $('personalEmployee').onchange();
assert.deepEqual(calls.slice(-2),['work:8','paid:8']);
$('personalEmployee').value='';
calls.length=0;
await $('personalEmployee').onchange();
assert.deepEqual(calls,['clearWork','clearBalance']);
assert.ok(groups.every(g=>g.disabled));
allowed=false;calls.length=0;
await $('personalEmployee').onchange();
assert.deepEqual(calls,[]);
const positions=['data-admin-panel="pending"','data-admin-panel="approved"','id="personalEmployeeSelector"','aria-label="個人管理メニュー"'].map(s=>html.indexOf(s));
assert.ok(positions.every((p,i)=>p>=0 && (!i||p>positions[i-1])));
assert.equal((html.match(/data-personal-controls disabled/g)||[]).length,4);
console.log('PASS: global/personal layout, shared employee sync, department reset, edit clearing, unselected controls, permission guard and global-list isolation');
