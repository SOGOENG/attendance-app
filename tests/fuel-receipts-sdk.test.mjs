// Uses the actual pinned Supabase SDK, with HTTP fully intercepted (no network).
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
if(!process.env.SUPABASE_SDK_MODULE)throw Error('Set SUPABASE_SDK_MODULE to @supabase/supabase-js dist/main/index.js');
const {createClient}=await import(pathToFileURL(process.env.SUPABASE_SDK_MODULE).href);
const calls=[];
const client=createClient('https://isolated.invalid','service-test-key',{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:async(input,init={})=>{
 const url=typeof input==='string'?input:input.url,headers=new Headers(init.headers||input.headers);calls.push({url,method:init.method||'GET',auth:headers.get('Authorization')});
 if(url.endsWith('/auth/v1/user'))return Response.json({id:'00000000-0000-0000-0000-000000000001',aud:'authenticated',role:'authenticated',email:'test@invalid.example',created_at:'2026-10-17T00:00:00Z'});
 if(url.includes('/rest/v1/rpc/'))return Response.json({manager:false});
 if(url.includes('/object/sign/'))return Response.json({signedURL:'/object/sign/fuel-receipts/test?token=isolated'});
 if(init.method==='DELETE')return Response.json([{name:'test'}]);
 if(init.method==='POST')return Response.json({Key:'fuel-receipts/test',Id:'test'});
 return new Response(new Uint8Array([255,216,255]),{headers:{'Content-Type':'image/jpeg'}});
}}});
assert.equal((await client.auth.getUser('user-test-token')).error,null);
assert.equal((await client.rpc('fuel_receipt_command',{p_action:'access'})).error,null);
const bucket=client.storage.from('fuel-receipts');
assert.equal((await bucket.upload('test',new Uint8Array([255,216,255]),{upsert:false})).error,null);
assert.equal((await bucket.download('test')).error,null);
assert.equal((await bucket.createSignedUrl('test',60)).error,null);
assert.equal((await bucket.remove(['test'])).error,null);
assert.equal(calls[0].auth,'Bearer user-test-token');assert.equal(calls.length,6);
assert(calls.slice(1).every(c=>c.auth==='Bearer service-test-key'));
console.log('PASS actual Supabase SDK 2.49.8: getUser uses caller JWT, subsequent RPC/Storage upload/read/sign/delete keep service credentials. All HTTP mocked.');
