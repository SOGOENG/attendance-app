import {csv,filePaths,zip,sha256,detectType} from './archive.mjs';
const bucket='fuel-receipts';
const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info','Access-Control-Expose-Headers':'X-Receipt-Export,Content-Length','Access-Control-Allow-Methods':'POST,OPTIONS','Cache-Control':'no-store'};
export function createReceiptHandler(client){
 return async request=>{
  const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{...cors,'Content-Type':'application/json'}});
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
  if(request.method!=='POST')return json({error:'POST required'},405);
  const token=request.headers.get('authorization')?.match(/^Bearer (.+)$/i)?.[1];
  if(!token)return json({error:'認証情報がありません。'},401);
  let actor;
  try{const {data,error}=await client.auth.getUser(token);if(error||!data.user)throw Error('invalid');actor=data.user.id;}catch{return json({error:'再ログインしてください。'},401);}
  const command=async(action,data={})=>{const result=await client.rpc('fuel_receipt_command',{p_actor:actor,p_action:action,p_data:data});if(result.error){const error=Error(result.error.message);error.code=result.error.code;throw error;}return result.data;};
  const storage=client.storage.from(bucket);
  const remove=async(id,archiveJob=null)=>{
   const archiving=archiveJob!==null;
   if(archiving&&!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(archiveJob))throw Error('対象ZIPの出力IDを確認してください。');
   const c=await command(archiving?'archive_begin':'remove_begin',{id,export_id:archiveJob});
   if(!['removed','archived'].includes(c.state)){
    const result=await storage.remove([c.object_path]);if(result.error)throw Error('ファイル削除に失敗しました。再試行できます。');
   }
   return command(archiving?'archive_done':'remove_done',{id,export_id:archiveJob});
  };
  try{
   // Bound chunked requests too, before JSON/FormData parsers allocate the body.
   if(request.body){
    const reader=request.body.getReader(),chunks=[];let size=0;
    for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>9*1024*1024){await reader.cancel();throw Error('送信サイズが9MBを超えています。');}chunks.push(value);}
    request=new Request(request.url,{method:'POST',headers:request.headers,body:new Blob(chunks)});
   }
   const access=await command('access');
   if(request.headers.get('content-type')?.includes('multipart/form-data')){
    const length=Number(request.headers.get('content-length')||0);if(length>9*1024*1024)throw Error('添付は8MB以下にしてください。');
    const form=await request.formData(),file=form.get('file'),id=String(form.get('id')),refuel=Number(form.get('refuel_id'));
    if(!(file instanceof Blob)||file.size<1||file.size>8388608||!/^[a-f0-9-]{36}$/i.test(id)||!Number.isSafeInteger(refuel))throw Error('添付ファイルの指定を確認してください。');
    const bytes=new Uint8Array(await file.arrayBuffer()),mime=detectType(bytes),hash=await sha256(bytes);
    const c=await command('reserve',{id,refuel_id:refuel,mime,bytes:file.size,sha256:hash,name:file.name||'receipt'});
    if(c.state==='active')return json(c);
    if(c.state!=='pending')throw Error('この添付操作は完了済みです。再読み込みしてください。');
    try {
    const uploaded=await storage.upload(c.object_path,bytes,{contentType:mime,upsert:false});
    if(uploaded.error){
     // Retry is allowed only if the existing object matches the reserved hash.
     const existing=await storage.download(c.object_path);
     if(existing.error||await sha256(new Uint8Array(await existing.data.arrayBuffer()))!==hash)throw Error('アップロードに失敗しました。同じファイルで再試行するか、添付を削除してください。');
    }
    const versions=await command('get',{refuel_id:refuel});
    for(const old of versions.filter(v=>['active','deleting'].includes(v.state)&&v.id!==id))await remove(old.id);
    return json(await command('finalize',{id}));
    } catch(error) { await command('file_failure',{id,error:error.message}).catch(()=>{}); throw error; }
   }
   const body=await request.json(),action=body.action,data=body.data||{};
   if(['export','list'].includes(action)&&!/^\d{4}-(0[1-9]|1[0-2])$/.test(data.month||''))throw Error('対象年月を選択してください。');
   if(['access','get','review','list','roles','exports','backup','approve','export_downloaded','export_failed'].includes(action))return json(await command(action,data));
   if(action==='view'){
    const c=await command('view',{id:data.id});
    const result=await storage.createSignedUrl(c.object_path,60);
    if(result.error)throw Error('領収書を取得できません。');return json({url:result.data.signedUrl,mime:c.mime});
   }
   if(action==='remove'){
    try{return json(await remove(data.id));}catch(error){await command('file_failure',{id:data.id,error:error.message}).catch(()=>{});throw error;}
   }
   if(action==='archive'){
    if(!access.admin)throw Object.assign(Error('削除には全体管理者の承認と権限が必要です。'),{code:'42501'});
    if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(data.export_id||''))throw Error('対象ZIPの出力IDを確認してください。');
    if(!Array.isArray(data.ids)||!data.ids.length||data.ids.length>25)throw Error('一度の削除は25件までです。');
    const results=[];for(const id of data.ids){try{await remove(id,data.export_id);results.push({id,success:true});}catch(error){await command('file_failure',{id,error:error.message}).catch(()=>{});results.push({id,success:false,error:error.message});}}
    await command('archive_batch',{export_id:data.export_id,count:results.length,results});
    return json(results);
   }
   if(action==='export'){
    if(!access.manager)throw Object.assign(Error('経理権限が必要です。'),{code:'42501'});
    const job=await command('export_start',{month:data.month}),paths=filePaths(job);
    async function* files(){
     const manifest={export_id:job.id,files:job.manifest.files.map(f=>({id:f.id,sha256:f.sha256,bytes:f.bytes,name:paths.get(f.id)}))};
     yield {name:`${data.month}/manifest.json`,bytes:new TextEncoder().encode(JSON.stringify(manifest,null,2))};
     yield {name:`${data.month}/給油領収書一覧.csv`,bytes:csv(job.manifest.rows,paths)};
     for(const file of job.manifest.files){
      const c=await command('view',{id:file.id});if(c.sha256!==file.sha256)throw Error('領収書が変更されました。');
      const result=await storage.download(file.path);if(result.error)throw Error('領収書の読み出しに失敗しました。');
      const bytes=new Uint8Array(await result.data.arrayBuffer());if(bytes.length!==file.bytes||await sha256(bytes)!==file.sha256)throw Error('領収書の整合性が一致しません。');
      yield {name:paths.get(file.id),bytes};
     }
    }
    const iterator=zip(files());let finished=false;
    const failed=async error=>{await command('export_failed',{export_id:job.id,error:String(error)}).catch(()=>{});};
    const stream=new ReadableStream({
     async pull(controller){try{const next=await iterator.next();if(next.done){await command('export_generated',{export_id:job.id});finished=true;controller.close();}else controller.enqueue(next.value);}catch(error){await failed(error);controller.error(error);}},
     async cancel(){if(!finished)await failed('download_cancelled');await iterator.return?.();}
    });
    return new Response(stream,{headers:{...cors,'Content-Type':'application/zip','Content-Disposition':`attachment; filename="fuel-receipts-${data.month}.zip"`,'X-Receipt-Export':job.id}});
   }
   return json({error:'未対応の操作です。'},400);
  }catch(error){
   const messages={delete_not_started:'削除開始を確認できません。再読み込みして確認してください。',delete_context_mismatch:'削除対象ZIPまたは削除方法が一致しません。',archive_in_progress:'このZIPの画像削除中はバックアップ確認を変更できません。削除を完了または再試行してください。',active_employee_required:'有効な社員情報を確認できません。',accounting_required:'経理担当者の権限が必要です。',admin_required:'全体管理者の権限が必要です。',receipt_access_denied:'この領収書を参照・操作する権限がありません。',own_draft_required:'本人の下書き日報だけ添付を変更できます。',vehicle_required:'車両を選択して保存してください。',receipt_storage_quota_exceeded:'領収書の保存容量が上限に達しました。経理担当者へ連絡してください。',idempotency_conflict:'添付操作が競合しました。再読み込みして確認してください。',receipt_not_available:'この画像は未保存・削除処理中・アーカイブ済みのため表示できません。',receipt_locked:'添付を処理中です。再読み込みして確認してください。',archive_preconditions_not_met:'保存後1年・ZIP保存・会社側バックアップ照合・保存義務確認・管理者承認の条件を満たしていません。',backup_attestations_required:'ZIP保存・会社管理の保存先・保存義務の確認が必要です。',backup_manifest_mismatch:'バックアップのファイル件数またはSHA-256が一致しません。',verified_manifest_required:'バックアップ照合結果を指定してください。',archive_approval_denied:'バックアップ確認と全体管理者による承認が必要です。',export_actor_required:'出力を実行した担当者が保存結果を確認してください。',export_not_generated:'ZIPの生成が完了していません。',export_state_conflict:'出力状態が変更されました。再読み込みしてください。'};
   return json({error:messages[error.message]||(error.code==='23505'?'他の添付操作が進行中です。再読み込みして確認してください。':error.message)||'領収書処理に失敗しました。'},error.code==='42501'?403:400);
  }
 };
}
