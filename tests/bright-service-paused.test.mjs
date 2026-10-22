import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHandler} from '../supabase/functions/bright-service/paused-handler.mjs';
const entry=await readFile(new URL('../supabase/functions/bright-service/index.ts',import.meta.url),'utf8');
assert(entry.includes('./paused-handler.mjs'));assert(!entry.includes('"./handler.mjs"'));
for(const actor of [{active:true,admin_scope:'all'},{active:true,admin_scope:'工事部'},{active:true,admin_scope:'none'},{active:false,admin_scope:'all'},null]){
 let reads=0;
 const createClient=(_url,key)=>key==='anon'?{auth:{getUser:async()=>({data:{user:{id:'self'}}})}}:{from(table){assert.equal(table,'employees');return {select(){return this;},eq(k,v){assert.equal(k,'auth_user_id');assert.equal(v,'self');return this;},async maybeSingle(){reads++;return {data:actor};}};}};
 const handler=createHandler({createClient,env:k=>({SUPABASE_URL:'https://mock.invalid',SUPABASE_ANON_KEY:'anon',SUPABASE_SERVICE_ROLE_KEY:'test-only'})[k]});
 for(const action of ['create','delete','creation_status',undefined]){
  const response=await handler(new Request('https://mock.invalid',{method:'POST',headers:{Authorization:'Bearer test-only'},body:JSON.stringify({action,creationEnabled:true})}));
  const allowed=actor?.active===true&&actor.admin_scope==='all';
  assert.equal(response.status,allowed?(action==='delete'?403:503):403);
  const body=await response.json();assert.notEqual(body.success,true);
 }
 assert.equal(reads,4);
 assert.equal((await handler(new Request('https://mock.invalid',{method:'POST'}))).status,401);
 assert.equal((await handler(new Request('https://mock.invalid',{method:'OPTIONS'}))).status,200);
}
console.log('PASS paused production entry: authorization, create/delete/status denied; no write/Auth-admin/RPC capabilities in mock');
