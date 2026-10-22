// Production contract: POST action=create/delete; employees -> Auth -> linkage.
// No automatic DELETE compensation until FK/trigger side effects are reviewed.
const cors = { 'Access-Control-Allow-Origin':'*', 'Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods':'POST, OPTIONS' };
const reply=(status,body)=>new Response(JSON.stringify(body),{status,headers:{...cors,'Content-Type':'application/json'}});
const fields=['name','department','active','admin_scope','attendance_required','improvement_required','near_miss_required'];
// Production entry point keeps creation disabled. True is used only by isolated
// tests; no request field or environment variable can switch it on.
export function createHandler({createClient,env,creationEnabled=false}) {
 return async req=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:cors});
  if(req.method!=='POST')return reply(405,{error:'POSTで実行してください'});
  let operationId=null;
  try {
   const url=env('SUPABASE_URL'),key=env('SUPABASE_SERVICE_ROLE_KEY'),anon=env('SUPABASE_ANON_KEY');
   if(!url||!key||!anon)return reply(500,{error:'サーバー設定を確認してください'});
   const authorization=req.headers.get('Authorization');
   if(!/^Bearer\s+\S+$/i.test(authorization||''))return reply(401,{error:'ログイン情報がありません'});
   const userClient=createClient(url,anon,{global:{headers:{Authorization:authorization}}});
   const {data:userData,error:userError}=await userClient.auth.getUser();
   if(userError||!userData?.user)return reply(401,{error:'ログイン情報を確認できません'});
   const admin=createClient(url,key,{auth:{autoRefreshToken:false,persistSession:false}});
   const {data:actor,error:actorError}=await admin.from('employees').select('id,active,admin_scope,auth_user_id').eq('auth_user_id',userData.user.id).maybeSingle();
   if(actorError)return reply(500,{error:'管理者情報を確認できません'});
   if(!actor||actor.active!==true||actor.admin_scope!=='all')return reply(403,{error:'全体管理者のみ操作できます'});
   let body;try{body=await req.json();}catch{return reply(400,{error:'JSON形式で送信してください'});}
   if(!body||Array.isArray(body)||typeof body!=='object')return reply(400,{error:'入力形式が不正です'});
   if(body.action==='delete')return reply(403,{error:'完全削除は安全性確認まで停止中です。使用停止を利用してください。',code:'employee_delete_disabled'});
   if(body.action==='creation_status'){
    if(body.operationId!==undefined && (typeof body.operationId!=='string'||!/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(body.operationId)))return reply(400,{error:'操作IDを確認してください'});
    const result=await admin.rpc('employee_creation_status',{p_actor:userData.user.id,p_operation:body.operationId??null});
    return result.error?reply(503,{error:'登録状況を取得できません。復旧確認が終わるまで再登録しないでください。'}):reply(200,{creationEnabled:false,operations:result.data});
   }
   if(body.action!=='create')return reply(400,{error:'不正な操作です'});
   if(!creationEnabled)return reply(503,{error:'社員登録は安全性・復旧手順の確認まで停止中です。登録状況を確認してください。',code:'employee_creation_paused',creationEnabled:false});
   if(Object.keys(body).some(k=>![...fields,'action','operationId','initialPassword'].includes(k)))return reply(400,{error:'許可されない項目があります'});
   if(typeof body.operationId!=='string'||!/^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i.test(body.operationId))return reply(400,{error:'操作IDを確認してください'});
   operationId=body.operationId;
   if(typeof body.name!=='string'||!body.name.trim()||body.name.trim().length>100
    ||!['工事部','技術部','営業部','総務部'].includes(body.department)
    ||!['none','all','tool_admin','工事部','技術部','営業部','総務部'].includes(body.admin_scope)
    ||fields.slice(2).filter(k=>k!=='admin_scope').some(k=>typeof body[k]!=='boolean')
    ||typeof body.initialPassword!=='string'||body.initialPassword.length<6||body.initialPassword.length>128)return reply(400,{error:'入力値を確認してください',operationId});
   const data=Object.fromEntries(fields.map(k=>[k,k==='name'?body.name.trim():body[k]]));
   const {data:op,error:beginError}=await admin.rpc('begin_employee_creation',{p_actor:userData.user.id,p_operation:operationId,p_data:data});
   if(beginError||!op)return reply(409,{error:'登録開始の結果を確認できません。同じ操作IDで確認してください。',operationId,recoveryRequired:true});
   operationId=op.operationId||operationId;
   if(!op.process)return op.state==='completed'?reply(200,{success:true,employeeId:op.employeeId,operationId,replayed:true}):reply(409,{error:'登録処理中または復旧確認が必要です。再登録せず管理者が確認してください。',operationId,recoveryRequired:true});
   const mark=async failure=>{
    try{const result=await admin.rpc('finish_employee_creation',{p_actor:userData.user.id,p_operation:operationId,p_auth:null,p_failure:failure});
     // A lost finish response may already have committed successfully.
     if(!result.error&&result.data?.state==='completed')return reply(200,{success:true,employeeId:op.employeeId,operationId});
     return reply(409,{error:'登録を完了できません。自動削除は行っていません。操作IDで復旧確認してください。',operationId,recoveryRequired:true,recoveryRecorded:!result.error&&result.data?.state==='recovery_required'});
    }catch{return reply(409,{error:'処理結果と復旧記録を確認できません。操作IDで確認してください。',operationId,recoveryRequired:true,recoveryRecorded:false});}
   };
   let auth;
   try{auth=await admin.auth.admin.createUser({email:`employee-${op.employeeId}@staff-portal.local`,password:body.initialPassword,email_confirm:true});}
   catch{return mark('auth_create_failed_or_unknown');}
   if(auth.error||!auth.data?.user)return mark('auth_create_failed_or_unknown');
   try{
    const finish=await admin.rpc('finish_employee_creation',{p_actor:userData.user.id,p_operation:operationId,p_auth:auth.data.user.id,p_failure:null});
    if(finish.error||finish.data?.state!=='completed')return mark('link_failed_or_unknown');
    return reply(200,{success:true,employeeId:op.employeeId,operationId});
   }catch{return mark('link_failed_or_unknown');}
  }catch{
   // Never log request bodies, SDK errors, passwords, JWTs or service keys.
   return reply(500,{error:'社員登録の結果を確認できません。再登録前に状態を確認してください。',operationId,recoveryRequired:true});
  }
 };
}
