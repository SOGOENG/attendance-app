import assert from 'node:assert/strict';
import {createHandler} from '../supabase/functions/bright-service/handler.mjs';
const operationId='00000000-0000-4000-8000-000000000001';
const body={action:'create',operationId,name:'New',department:'工事部',active:true,admin_scope:'none',attendance_required:true,improvement_required:true,near_miss_required:true,initialPassword:'secret-password'};
function fixture(options={}){
 const calls=[];let state='employee_created',begun=false;
 const admin={from(){return {select(){return this;},eq(){return this;},async maybeSingle(){return {data:options.actor??{id:1,active:true,admin_scope:'all'}};}};},
  async rpc(name,args){calls.push({name,args});
   if(name==='employee_creation_status')return {data:[{operation_id:operationId,state:'recovery_required',employee_id:10}]};
   if(name==='begin_employee_creation'){
    if(options.beginFailure)throw Error('uncertain');
    const process=!begun;begun=true;return {data:{process,state,employeeId:10}};
   }
   if(args.p_failure){
    if(options.recordFailure)throw Error('record failed');
    if(state!=='completed')state='recovery_required';
    return {data:{state}};
   }
   if(options.linkFailure)return {error:{message:'link failed'}};
   state='completed';if(options.lostFinishResponse)throw Error('response lost');
   return {data:{state}};
  },auth:{admin:{async createUser(data){calls.push({name:'createUser',data});if(options.authThrow)throw Error('unknown');if(options.authFailure)return {error:{message:'failed'}};return {data:{user:{id:'auth-new'}}};}}}};
 const handler=createHandler({creationEnabled:options.creationEnabled??true,env:k=>({SUPABASE_URL:'https://test.invalid',SUPABASE_ANON_KEY:'anon',SUPABASE_SERVICE_ROLE_KEY:'service'})[k],
  createClient:(_,key)=>key==='anon'?{auth:{async getUser(){return options.invalidJwt?{error:{}}:{data:{user:{id:'actor'}}};}}}:admin});
 const request=async(data=body)=>{const r=await handler(new Request('https://test.invalid',{method:'POST',headers:{Authorization:'Bearer test'},body:JSON.stringify(data)}));return {status:r.status,data:await r.json()};};
 return {calls,request};
}
let count=0;async function test(name,fn){await fn();count++;console.log('PASS '+name);}
await test('production pause prevents any mutation, status remains available to full admins',async()=>{
 const f=fixture({creationEnabled:false});
 const paused=await f.request();assert.equal(paused.status,503);assert.equal(paused.data.code,'employee_creation_paused');assert.equal(f.calls.length,0);
 const status=await f.request({action:'creation_status'});assert.equal(status.status,200);assert.equal(status.data.operations[0].state,'recovery_required');
 assert.deepEqual(f.calls.map(c=>c.name),['employee_creation_status']);
 assert.equal((await fixture({actor:{active:true,admin_scope:'工事部'}}).request({action:'creation_status'})).status,403);
});
await test('JWT required; only active all may create; delete never invokes destructive APIs',async()=>{
 for(const actor of [{active:true,admin_scope:'none'},{active:true,admin_scope:'工事部'},{active:true,admin_scope:'tool_admin'},{active:false,admin_scope:'all'}]){
  const f=fixture({actor});assert.equal((await f.request()).status,403);assert.equal(f.calls.length,0);
 }
 assert.equal((await fixture({invalidJwt:true}).request()).status,401);
 const f=fixture();assert.equal((await f.request({action:'delete',employeeId:2})).status,403);assert.equal(f.calls.length,0);
});
await test('production creation order, ID-derived email, no secret in operation record, duplicate suppressed',async()=>{
 const f=fixture();assert.equal((await f.request()).data.success,true);
 assert.deepEqual(f.calls.map(c=>c.name),['begin_employee_creation','createUser','finish_employee_creation']);
 assert.equal(f.calls[1].data.email,'employee-10@staff-portal.local');
 assert(!JSON.stringify(f.calls.filter(c=>c.args)).includes(body.initialPassword));
 assert.equal((await f.request()).data.success,true);assert.equal(f.calls.filter(c=>c.name==='createUser').length,1);
});
await test('Auth and link failure report recovery, do not delete, do not recreate on retry',async()=>{
 for(const options of [{authFailure:true},{authThrow:true},{linkFailure:true},{linkFailure:true,recordFailure:true}]){
  const f=fixture(options);const r=await f.request();assert.equal(r.status,409);assert.equal(r.data.recoveryRequired,true);assert.notEqual(r.data.success,true);
  assert.equal(f.calls.filter(c=>c.name==='createUser').length,1);
  assert.equal((await f.request()).status,409);assert.equal(f.calls.filter(c=>c.name==='createUser').length,1);
  if(options.recordFailure)assert.equal(r.data.recoveryRecorded,false);
 }
});
await test('lost final response reconciles committed completion; unknown start is never success',async()=>{
 assert.equal((await fixture({lostFinishResponse:true}).request()).data.success,true);
 const f=fixture({beginFailure:true});const r=await f.request();assert.equal(r.status,500);assert.equal(r.data.recoveryRequired,true);assert.equal(f.calls.length,1);
});
await test('input whitelist and operation ID are enforced before mutation',async()=>{
 for(const patch of [{auth_user_id:'attack'},{operationId:null},{active:'true'},{admin_scope:'unknown'}]){
  const f=fixture();assert.equal((await f.request({...body,...patch})).status,400);assert.equal(f.calls.length,0);
 }
});
console.log(`Bright service: ${count} groups passed.`);
