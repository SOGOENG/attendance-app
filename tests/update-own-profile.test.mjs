// Execute the actual TypeScript handler with a mocked SDK; no network or Auth.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {stripTypeScriptTypes} from 'node:module';
import {runInNewContext} from 'node:vm';
const source=(await readFile(new URL('../supabase/functions/update-own-profile/index.ts',import.meta.url),'utf8'))
  .replace(/^import .*?;\s*/,'');
const javascript=stripTypeScriptTypes(source);
function fixture(options={}) {
 const rows=structuredClone(options.rows??[{id:1,active:true,auth_user_id:'self',profile_email:'old@example.test',phone_number:'old'}]);
 const calls=[];let handler;
 const sdk={auth:{async getUser(){return options.badJwt?{data:{user:null},error:{}}:{data:{user:{id:'self'}}};}},from(table){
  assert.equal(table,'employees');const filters=[];let update=null;
  const query={select(columns){calls.push({select:columns});return this;},eq(k,v){filters.push([k,v]);return this;},
   async limit(n){return {data:rows.filter(row=>filters.every(([k,v])=>row[k]===v)).slice(0,n)};},
   update(values){update=values;calls.push({update:values});if(options.disableDuringUpdate)rows[0].active=false;return this;},
   async maybeSingle(){
    calls.push({filters});if(options.updateFailure)return {error:{message:'fixture error'}};
    const targets=rows.filter(row=>filters.every(([k,v])=>row[k]===v));assert(targets.length<=1);
    if(!targets.length)return {data:null};Object.assign(targets[0],update);
    return {data:{profile_email:targets[0].profile_email,phone_number:targets[0].phone_number}};
   }};return query;
 }};
 runInNewContext(javascript,{Request,Response,console:{error(){}},createClient:()=>sdk,
  Deno:{env:{get:()=> 'fixture'},serve:fn=>{handler=fn;}}});
 return {rows,calls,async request(body={profile_email:' new@example.test ',phone_number:' 090 '},token='Bearer fixture'){
  const response=await handler(new Request('https://fixture.invalid',{method:'POST',headers:token?{Authorization:token}:{},body:JSON.stringify(body)}));
  return {status:response.status,data:await response.json()};
 }};
}
let count=0;async function test(name,fn){await fn();count++;console.log('PASS '+name);}
await test('active employee updates own allowed fields with preserved response and normalization',async()=>{
 const f=fixture();const r=await f.request();assert.equal(r.status,200);assert.equal(r.data.success,true);
 assert.equal(r.data.profile_email,'new@example.test');assert.equal(r.data.phone_number,'090');
 assert(f.calls.some(c=>c.select==='id,active'));
 assert.deepEqual(f.calls.find(c=>c.filters).filters,[['id',1],['auth_user_id','self'],['active',true]]);
});
await test('anonymous/invalid JWT/unlinked/inactive rejected before update',async()=>{
 assert.equal((await fixture().request({},null)).status,401);
 assert.equal((await fixture({badJwt:true}).request()).status,401);
 for(const [rows,status] of [[[],404],[[{id:1,active:false,auth_user_id:'self'}],403]]){
  const f=fixture({rows});assert.equal((await f.request()).status,status);assert(!f.calls.some(c=>c.update));
 }
});
await test('inactive duplicate is still detected instead of filtering it out',async()=>{
 const f=fixture({rows:[{id:1,auth_user_id:'self',active:true},{id:2,auth_user_id:'self',active:false}]});
 assert.equal((await f.request()).status,409);assert(!f.calls.some(c=>c.update));
});
await test('disable between lookup and UPDATE prevents write and success response',async()=>{
 const f=fixture({disableDuringUpdate:true});const r=await f.request();assert.equal(r.status,403);
 assert.notEqual(r.data.success,true);assert.equal(f.rows[0].phone_number,'old');
});
await test('whitelist, invalid input, empty values and database failure retain behavior',async()=>{
 for(const body of [{active:true},{profile_email:'invalid'},{phone_number:'x'.repeat(101)}]){
  const f=fixture();assert.equal((await f.request(body)).status,400);assert(!f.calls.some(c=>c.update));
 }
 const blank=await fixture().request({profile_email:' ',phone_number:''});assert.equal(blank.status,200);assert.equal(blank.data.profile_email,null);
 const failed=await fixture({updateFailure:true}).request();assert.equal(failed.status,500);assert.equal(failed.data.success,false);
});
console.log(`Own profile: ${count} groups passed.`);
