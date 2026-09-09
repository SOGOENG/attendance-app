import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const source=await readFile(new URL('../applications-admin.js',import.meta.url),'utf8');
const html=await readFile(new URL('../applications-admin.html',import.meta.url),'utf8');
const employee={value:''},list={innerHTML:''},requests=[];
let respond=async()=>[],allowed=true;
const context=vm.createContext({Number,Map,Set,console:{error(){}},
  $:id=>id==='personalEmployee'?employee:list,
  sites:[{id:10,display_name:'現場A'}],
  isLeaveManager:()=>allowed,
  historyPrompt:()=>'<p>対象社員を選択してください</p>',
  esc:s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;'),
  dt:s=>s?s.replaceAll('-','/'):'-',
  req:async path=>{requests.push(path);return respond(path);}
});
vm.runInContext(source.slice(source.indexOf('let compExpirationGeneration'),source.indexOf('// Shared employee context')),context);
await context.loadCompExpirationHistory();
assert.equal(requests.length,0);assert.match(list.innerHTML,/対象社員を選択してください/);
employee.value='7';
const row={id:1,work_date:'2025-08-23',valid_until_date:'2026-08-23',expiration_date:'2026-08-24',earned_days:'1',used_days_at_expiration:'0',expired_days:'1',site_id:10,note:'<img src=x>'};
respond=async()=>[row,{...row,id:2,expired_days:'.5',site_id:null,note:null}];
await context.loadCompExpirationHistory();
assert.match(requests.at(-1),/employee_id=eq.7&order=expiration_date.desc,id.desc$/);
for(const text of ['失効合計 1.5日','有効期限：2026/08/23','失効日：2026/08/24','現場A','現場未設定','備考：-','&lt;img'])assert.ok(list.innerHTML.includes(text),text);
assert.ok(!list.innerHTML.includes('<img'));
respond=async path=>path.startsWith('sites?')?[{id:99,display_name:'過去の現場'}]:[{...row,site_id:99}];
await context.loadCompExpirationHistory();assert.match(list.innerHTML,/過去の現場/);
respond=async()=>[];await context.loadCompExpirationHistory();
assert.match(list.innerHTML,/失効合計 0日/);assert.match(list.innerHTML,/代休の失効履歴はありません。/);
let resolveOld;
respond=()=>new Promise(resolve=>resolveOld=resolve);
const old=context.loadCompExpirationHistory();
employee.value='8';context.clearCompExpirationHistory();respond=async()=>[];
await context.loadCompExpirationHistory();const newHtml=list.innerHTML;
resolveOld([row]);await old;assert.equal(list.innerHTML,newHtml);
respond=async()=>{throw Error('offline');};await context.loadCompExpirationHistory();assert.match(list.innerHTML,/読み込めませんでした/);
employee.value='';context.clearCompExpirationHistory();assert.match(list.innerHTML,/対象社員を選択してください/);
const count=requests.length;employee.value='7';allowed=false;await context.loadCompExpirationHistory();assert.equal(requests.length,count);
assert.match(html,/<details class="work-disclosure" id="compExpirationSection"><summary>代休失効履歴<\/summary>/);
console.log('PASS: employee filtering, ordering, sum, dates, site names, escaping, empty/error states, stale response and closed disclosure');
