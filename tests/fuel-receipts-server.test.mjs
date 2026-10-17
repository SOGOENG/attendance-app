import assert from 'node:assert/strict';
import {writeFile,mkdtemp,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createReceiptHandler} from '../supabase/functions/fuel-receipts/handler.mjs';
import {sha256,zip,csv,safeName,detectType} from '../supabase/functions/fuel-receipts/archive.mjs';
const bytes=new Uint8Array([255,216,255,1,2,3,4,5]),hash=await sha256(bytes);
assert.equal(detectType(bytes),'image/jpeg');assert.equal(detectType(new TextEncoder().encode('%PDF-1.7')),'application/pdf');
assert.throws(()=>detectType(new Uint8Array([1,2,3])));assert(!safeName('../a/b\\c').includes('/'));
const csvBytes=csv([{fuel_date:'2026-10-17',employee_name:'=cmd',vehicle:'a,"b',liters:1,received:false}],new Map());
assert.equal(new TextDecoder('utf-8',{ignoreBOM:true}).decode(csvBytes).charCodeAt(0),0xfeff);
assert(new TextDecoder().decode(csvBytes).includes("'=cmd"));
const receipts=new Map(),objects=new Map(),events=[];let deletesFail=false,downloadFail=false,failDone=false,backupReady=false,submitted=false;
let deleteCalls=0;
const owner='00000000-0000-0000-0000-000000000001',admin='00000000-0000-0000-0000-000000000003';
const accountant='00000000-0000-0000-0000-000000000002';
let exportJob;
const client={auth:{getUser:async token=>token==='bad'?{error:Error('bad')}:{data:{user:{id:token==='admin'?admin:token==='accountant'?accountant:owner}}}},
 rpc:async(_,{p_actor:actor,p_action:action,p_data:data})=>{
  events.push({actor,action,data});
  try{
   if(action==='access')return {data:{manager:actor===admin||actor===accountant,admin:actor===admin}};
   if(action==='roles'&&actor!==admin)throw Object.assign(Error('admin_required'),{code:'42501'});
   if(['list','review','exports','backup','approve'].includes(action)&&actor!==admin)throw Object.assign(Error('accounting_required'),{code:'42501'});
   if(['reserve','finalize','remove_begin','remove_done'].includes(action)&&(submitted||actor!==owner))throw Object.assign(Error('own_draft_required'),{code:'42501'});
   if(action==='get')return {data:[...receipts.values()].filter(c=>c.refuel_id===data.refuel_id&&c.state!=='removed')};
   if(action==='reserve'){
    if(receipts.has(data.id))return {data:receipts.get(data.id)};
    const c={...data,object_path:data.id,state:'pending'};receipts.set(c.id,c);return {data:c};
   }
   if(action==='finalize'){receipts.get(data.id).state='active';return {data:receipts.get(data.id)};}
   if(action==='view'){const c=receipts.get(data.id);if(!c||c.state!=='active')throw Error('receipt_not_available');return {data:c};}
   if(action==='remove_begin'){const c=receipts.get(data.id);if(c.state!=='removed')c.state='deleting';return {data:c};}
   if(action==='remove_done'){if(failDone){failDone=false;throw Error('mock DB completion failure');}const c=receipts.get(data.id);c.state='removed';return {data:c};}
   if(action==='archive_begin'){if(!backupReady)throw Error('archive_preconditions_not_met');const c=receipts.get(data.id);if(c.state!=='archived')c.state='deleting';return {data:c};}
   if(action==='archive_done'){if(failDone){failDone=false;throw Error('mock DB completion failure');}const c=receipts.get(data.id);c.state='archived';return {data:c};}
   if(action==='export_start'){
    const c=[...receipts.values()].find(c=>c.state==='active');
    exportJob={id:'export-1',month:'2026-10-01',manifest:{files:[{...c,path:c.object_path}],rows:[{receipt_id:c.id,employee_name:'../危険/社員',employee_id:1,fuel_date:'2026-10-17',refuel_id:c.refuel_id,liters:2}]}};return {data:exportJob};
   }
   return {data:{}};
  }catch(error){return {error};}
 },storage:{from:()=>({
  upload:async(path,data)=>{if(objects.has(path))return {error:Error('exists')};objects.set(path,data);return {data:{}};},
  download:async path=>downloadFail?{error:Error('missing')}:{data:new Blob([objects.get(path)])},
  remove:async paths=>{deleteCalls++;if(deletesFail)return {error:Error('delete failed')};paths.forEach(p=>objects.delete(p));return {data:{}};},
  createSignedUrl:async(path,ttl)=>({data:{signedUrl:`https://private.invalid/${path}?ttl=${ttl}`}})
 })}};
const handle=createReceiptHandler(client),url='https://edge.invalid/fuel-receipts';
const jsonRequest=(action,data={},token='owner')=>new Request(url,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({action,data,p_actor:admin})});
const upload=async(id,data=bytes)=>{const form=new FormData();form.set('id',id);form.set('refuel_id','1');form.set('file',new File([data],'a.jpg',{type:'image/jpeg'}));return handle(new Request(url,{method:'POST',headers:{Authorization:'Bearer owner'},body:form}));};
assert.equal((await handle(new Request(url,{method:'POST'}))).status,401);
assert.equal((await handle(jsonRequest('access',{},'bad'))).status,401);
for(const token of ['owner','accountant'])for(const enabled of [true,false])assert.equal((await handle(jsonRequest('roles',{employee_id:1,enabled},token))).status,403);
const id='10000000-0000-0000-0000-000000000001';assert.equal((await upload(id)).status,200);assert.equal(objects.size,1);
assert.equal((await upload(id)).status,200);assert.equal(objects.size,1);assert(events.filter(e=>e.action==='reserve').every(e=>e.actor===owner));
const signed=await(await handle(jsonRequest('view',{id}))).json();assert(signed.url.endsWith('ttl=60'));
const second='20000000-0000-0000-0000-000000000002';deletesFail=true;assert.equal((await upload(second)).status,400);assert.equal(receipts.get(id).state,'deleting');
// Recovery removes an interrupted old version before finalizing the replacement.
assert.equal((await handle(jsonRequest('remove',{id}))).status,400);deletesFail=false;
assert.equal((await upload(second)).status,200);assert.equal(receipts.get(id).state,'removed');assert.equal(objects.size,1);
const exported=await handle(jsonRequest('export',{month:'2026-10'},'admin'));assert.equal(exported.headers.get('X-Receipt-Export'),'export-1');
const zipBytes=new Uint8Array(await exported.arrayBuffer());assert(events.some(e=>e.action==='export_generated'));
assert(!events.some(e=>e.action==='export_downloaded')); // Button click / generated ZIP is not a backup acknowledgement.
const tmp=await mkdtemp(join(tmpdir(),'fuel-receipt-test-')),zipPath=join(tmp,'test.zip');await writeFile(zipPath,zipBytes);
execFileSync('python3',['-c','import zipfile,sys; z=zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None; assert all(".." not in n.split("/") for n in z.namelist()); z.extractall(sys.argv[2])',zipPath,tmp]);
const manifest=join(tmp,'2026-10','manifest.json'),proof=join(tmp,'backup-verification.json');
execFileSync('python3',['scripts/verify-fuel-receipt-backup.py',manifest,'--output',proof]);assert.equal(JSON.parse(await readFile(proof,'utf8')).files[0].sha256,hash);
downloadFail=true;const failed=await handle(jsonRequest('export',{month:'2026-10'},'admin'));await assert.rejects(()=>failed.arrayBuffer());assert(events.some(e=>e.action==='export_failed'));
const huge=new Request(url,{method:'POST',headers:{Authorization:'Bearer owner','Content-Type':'application/json'},body:new Uint8Array(9*1024*1024+1)});assert.equal((await handle(huge)).status,400);
const cancelled=await handle(jsonRequest('export',{month:'2026-10'},'admin'));await cancelled.body.cancel();assert(events.some(e=>e.action==='export_failed'&&e.data.error==='download_cancelled'));
let largeBytes=0;async function* manyFiles(){for(let i=0;i<600;i++)yield {name:`2026-10/item-${i}.jpg`,bytes:new Uint8Array(200*1024)};}
for await(const part of zip(manyFiles()))largeBytes+=part.length;assert(largeBytes>100*1024*1024); // Streaming consumption; no whole-ZIP buffer.
// Reject direct Edge operations before any Storage call.
assert.equal((await handle(jsonRequest('review',{refuel_id:1,received:true}))).status,403);
assert.equal((await handle(jsonRequest('export',{month:'2026-10'}))).status,403);
assert.equal((await handle(jsonRequest('archive',{ids:[second]}))).status,403);
submitted=true;let beforeDelete=deleteCalls;
assert.equal((await handle(jsonRequest('remove',{id:second}))).status,403);assert.equal(deleteCalls,beforeDelete);
submitted=false;
// Missing export_id must never fall back to normal draft removal.
assert.equal((await handle(jsonRequest('archive',{ids:[second]},'admin'))).status,400);assert.equal(deleteCalls,beforeDelete);
const archiveId='90000000-0000-0000-0000-000000000009';
const deniedArchive=await(await handle(jsonRequest('archive',{ids:[second],export_id:archiveId},'admin'))).json();
assert.equal(deniedArchive[0].success,false);assert.equal(deleteCalls,beforeDelete);
// Storage success followed by DB completion failure stays deleting; retry completes safely.
backupReady=true;failDone=true;const failedDone=await(await handle(jsonRequest('archive',{ids:[second],export_id:archiveId},'admin'))).json();
assert.equal(failedDone[0].success,false);assert.equal(objects.has(second),false);assert.equal(receipts.get(second).state,'deleting');
const retried=await(await handle(jsonRequest('archive',{ids:[second],export_id:archiveId},'admin'))).json();
assert.equal(retried[0].success,true);assert.equal(receipts.get(second).state,'archived');
beforeDelete=deleteCalls;await handle(jsonRequest('archive',{ids:[second],export_id:archiveId},'admin'));assert.equal(deleteCalls,beforeDelete);
const third='30000000-0000-0000-0000-000000000003';await upload(third);failDone=true;
assert.equal((await handle(jsonRequest('remove',{id:third}))).status,400);assert.equal(receipts.get(third).state,'deleting');assert.equal(objects.has(third),false);
assert.equal((await handle(jsonRequest('remove',{id:third}))).status,200);assert.equal(receipts.get(third).state,'removed');
const chunks=[];for await(const b of zip([{name:'empty.txt',bytes:new Uint8Array()}]))chunks.push(b);assert(chunks.length>0);
console.log('PASS receipt server: Auth verification, actor spoof ignored, magic types, size cap, idempotent upload, delete failure/retry, signed TTL, streamed valid ZIP/CSV, path safety, backup SHA/count script, download failure audit.');
