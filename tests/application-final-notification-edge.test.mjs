// Executes the real Edge handler with in-memory Supabase and Web Push adapters.
// No network calls, secrets or production services are used.
import {readFile} from 'node:fs/promises';
import {stripTypeScriptTypes} from 'node:module';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const source=(await readFile(new URL('../supabase/functions/send-staff-push-notifications/index.ts',import.meta.url),'utf8')).replace(/^import .*;\r?\n/gm,'');
const code=stripTypeScriptTypes(source,{mode:'strip',disableExperimentalWarning:true});
function setup(overrides={}){
 const employees=[
  {id:10,name:'Admin',active:true,admin_scope:'all',auth_user_id:'actor',is_application_final_approver:false},
  {id:20,name:'Final A',active:true,admin_scope:'all',is_application_final_approver:true},
  {id:30,name:'Final B',active:true,admin_scope:'all',is_application_final_approver:true},
  {id:40,name:'Inactive',active:false,admin_scope:'all',is_application_final_approver:true},
  {id:50,name:'Other admin',active:true,admin_scope:'all',is_application_final_approver:false},
  {id:60,name:'Applicant',active:true,is_application_final_approver:false}
 ];
 const application={id:7,employee_id:60,application_type:'paid_leave',status:'approved',final_approval_required:true,final_confirmed_at:null,...overrides};
 const subscriptions=[10,20,30,40,50,60].map(id=>({id,employee_id:id,active:true,endpoint:`https://push.invalid/${id}`,p256dh:'x',auth:'x'}));
 const deliveries=[],sent=[];let handler,login=true;
 function from(table){let method='select',payload,filters=[],single=false;
  const query={select(){return query},eq(k,v){filters.push(r=>r[k]===v);return query},in(k,v){filters.push(r=>v.includes(r[k]));return query},single(){single=true;return query},insert(v){method='insert';payload=v;return query},update(v){method='update';payload=v;return query},
   then(resolve,reject){try{let rows=[];
    if(table==='employees')rows=employees;
    if(table==='applications')rows=[application];
    if(table==='push_subscriptions')rows=subscriptions;
    if(table==='notification_deliveries'){
     if(method==='insert'){
      if(deliveries.some(d=>d.idempotency_key===payload.idempotency_key))return Promise.resolve({data:null,error:{code:'23505'}}).then(resolve,reject);
      const row={id:deliveries.length+1,...payload};deliveries.push(row);return Promise.resolve({data:{id:row.id},error:null}).then(resolve,reject);
     }
     rows=deliveries;
    }
    rows=rows.filter(r=>filters.every(f=>f(r)));
    if(method==='update')rows.forEach(r=>Object.assign(r,payload));
    return Promise.resolve({data:single?(rows[0]||null):rows,error:null}).then(resolve,reject);
   }catch(e){return Promise.reject(e).then(resolve,reject)}}};return query;
 }
 vm.runInNewContext(code,{Deno:{env:{get:()=> 'test-only'},serve:fn=>handler=fn},createClient:()=>({auth:{getUser:async()=>({data:{user:login?{id:'actor'}:null},error:null})},from}),webpush:{setVapidDetails(){},async sendNotification(subscription,payload){sent.push({endpoint:subscription.endpoint,...JSON.parse(payload)})}},Request,Response,TextEncoder,crypto,console,Set,Map});
 const invoke=async(event='approved')=>handler(new Request('https://edge.invalid',{method:'POST',headers:{authorization:'Bearer test','Content-Type':'application/json'},body:JSON.stringify({type:'application',application_id:7,event})}));
 return {invoke,employees,application,deliveries,sent,setLogin:v=>login=v};
}
const finalRows=s=>s.deliveries.filter(d=>d.notification_type==='application_final_confirmation_pending');
const s=setup();assert.equal((await s.invoke()).status,200);
assert.deepEqual(finalRows(s).map(d=>d.employee_id),[20,30]);
assert.deepEqual(s.deliveries.filter(d=>d.notification_type==='application_approved').map(d=>d.employee_id),[60]);
assert.equal(s.sent.length,3);
for(const n of s.sent.filter(x=>x.url==='./applications-final.html?panel=waiting')){
 assert.equal(n.title,'最終確認があります');assert.match(n.body,/最終確認をお願いします/);
}
assert.equal(s.sent.filter(x=>x.url==='./applications-final.html?panel=waiting').length,2);
await Promise.all([s.invoke(),s.invoke()]);assert.equal(s.deliveries.length,3);assert.equal(s.sent.length,3);
s.application.final_confirmed_at='2026-10-26T00:00:00Z';await s.invoke();assert.equal(s.deliveries.length,3);
for(const overrides of [{final_approval_required:false},{final_confirmed_at:'2026-10-26T00:00:00Z'}]){
 const t=setup(overrides);assert.equal((await t.invoke()).status,200);assert.equal(finalRows(t).length,0);assert.equal(t.sent.length,1);
}
for(const event of ['revision_required','rejected']){const t=setup({status:event});await t.invoke(event);assert.equal(finalRows(t).length,0);assert.equal(t.sent.length,1);}
const denied=setup();denied.employees[0].admin_scope=null;assert.equal((await denied.invoke()).status,403);assert.equal(denied.deliveries.length,0);
const inactive=setup();inactive.employees[0].active=false;assert.equal((await inactive.invoke()).status,404);assert.equal(inactive.sent.length,0);
const anonymous=setup();anonymous.setLogin(false);assert.equal((await anonymous.invoke()).status,401);assert.equal(anonymous.sent.length,0);
const mismatch=setup({status:'submitted'});assert.equal((await mismatch.invoke()).status,403);assert.equal(mismatch.sent.length,0);
console.log('PASS: real Edge handler, two flagged active recipients, ordinary/inactive exclusion, approval result preserved, old/confirmed/revision/rejected exclusion, atomic duplicate reservation, final link, unauthorized rejection');
