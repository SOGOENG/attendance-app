// Protocol 2. No production side effects until the DB rollout gate is enabled.
const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS'};
const reply=(status,body)=>new Response(JSON.stringify(body),{status,headers:{...cors,'Content-Type':'application/json'}});
const fields=['name','department','active','admin_scope','attendance_required','improvement_required','near_miss_required'];
const uuid=value=>typeof value==='string'&&/^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i.test(value);
export function createHandler({createClient,env,randomUUID=()=>crypto.randomUUID()}){
 return async req=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:cors});
  if(req.method!=='POST')return reply(405,{error:'POSTで実行してください'});
  let operationId=null;
  try{
   const url=env('SUPABASE_URL'),anon=env('SUPABASE_ANON_KEY'),key=env('SUPABASE_SERVICE_ROLE_KEY');
   if(!url||!anon||!key)return reply(503,{error:'サーバー設定を確認してください'});
   const authorization=req.headers.get('Authorization');
   if(!/^Bearer\s+\S+$/i.test(authorization||''))return reply(401,{error:'ログイン情報がありません'});
   const client=createClient(url,anon,{global:{headers:{Authorization:authorization}},auth:{persistSession:false,autoRefreshToken:false}});
   const identity=await client.auth.getUser();
   if(identity.error||!identity.data?.user)return reply(401,{error:'ログイン状態を確認してください'});
   const actorId=identity.data.user.id;
   const admin=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
   const actor=await admin.from('employees').select('id,active,admin_scope,auth_user_id').eq('auth_user_id',actorId).maybeSingle();
   if(actor.error)return reply(503,{error:'管理者情報を確認できません'});
   if(!actor.data||actor.data.active!==true||actor.data.admin_scope!=='all')return reply(403,{error:'有効な全体管理者のみ操作できます'});
   let body;try{body=await req.json();}catch{return reply(400,{error:'JSON形式で送信してください'});}
   if(!body||Array.isArray(body)||typeof body!=='object')return reply(400,{error:'入力形式が不正です'});
   if(body.action==='delete')return reply(403,{code:'employee_delete_disabled',error:'完全削除は停止中です。使用停止を利用してください。'});
   const rpc=async(name,args)=>{
    const response=await admin.rpc(name,{p_actor:actorId,...args});
    if(response.error||!response.data)throw Error('registration_unconfirmed');
    return response.data;
   };
   if(body.action==='creation_status'){
    if(body.operationId!==undefined&&!uuid(body.operationId))return reply(400,{error:'操作IDを確認してください'});
    const rows=await rpc('employee_creation_status',{p_operation:body.operationId??null});
    return reply(200,{operations:rows});
   }
   if(!['create','recover_creation'].includes(body.action))return reply(400,{error:'不正な操作です'});
   if(!uuid(body.operationId))return reply(400,{code:'registration_protocol_required',error:'最新の社員管理画面から操作してください。旧方式で再登録しないでください。'});
   operationId=body.operationId;
   const password=body.initialPassword;
   const validPassword=typeof password==='string'&&password.length>=8&&password.length<=128;
   const worker=randomUUID();
   let op;
   if(body.action==='create'){
    if(Object.keys(body).some(k=>![...fields,'action','operationId','initialPassword'].includes(k))||!validPassword
     ||typeof body.name!=='string'||!body.name.trim()||body.name.trim().length>100
     ||!['工事部','技術部','営業部','総務部'].includes(body.department)
     ||!['none','all','tool_admin','工事部','技術部','営業部','総務部'].includes(body.admin_scope)
     ||fields.slice(2).filter(k=>k!=='admin_scope').some(k=>typeof body[k]!=='boolean'))return reply(400,{error:'入力値を確認してください',operationId});
    const data=Object.fromEntries(fields.map(k=>[k,k==='name'?body.name.trim():body[k]]));
    op=await rpc('begin_employee_registration',{p_operation:operationId,p_data:data,p_worker:worker});
    operationId=op.operationId;
    if(!op.process){
     if(op.state==='completed')return reply(200,{success:true,employeeId:op.employeeId,operationId,replayed:true});
     return reply(409,{error:'登録処理中または要確認です。同じ操作の登録状況を確認してください。',operationId,recoveryRequired:true});
    }
    // Never create Auth with the intended initial password. If an older Auth
    // server ignores ban_duration, the unshared random credential still protects
    // password login. Real Auth isolation must be tested before enabling rollout.
    const created=await admin.auth.admin.createUser({email:`employee-${op.employeeId}@staff-portal.local`,
     password:'Aa9!'+randomUUID()+randomUUID().slice(0,20),email_confirm:false,ban_duration:'876000h',
     app_metadata:{employee_creation_operation:operationId,employee_creation_phase:'isolated'}});
    if(created.error||!created.data?.user)throw Error('auth_creation_unknown');
    op=await rpc('advance_employee_registration',{p_operation:operationId,p_worker:worker,p_step:'bind',p_auth:created.data.user.id});
   }else{
    if(Object.keys(body).some(k=>!['action','operationId','initialPassword'].includes(k)))return reply(400,{error:'許可されない項目があります'});
    op=await rpc('recover_employee_registration',{p_operation:operationId,p_worker:worker});
   }
   if(op.state==='completed')return reply(200,{success:true,employeeId:op.employeeId,operationId,recovered:true,replayed:true});
   if(op.state!=='auth_bound')throw Error('manual_recovery_required');
   if(!validPassword)return reply(409,{error:'隔離済みアカウントの解放には初期パスワードを入力してください。',operationId,recoveryRequired:true,passwordRequired:true});
   const advance=step=>rpc('advance_employee_registration',{p_operation:operationId,p_worker:worker,p_step:step,p_auth:op.authId});
   const grant=await advance('release'); // One-shot DB grant, reauthorizes the current actor.
   if(grant.state==='completed')return reply(200,{success:true,employeeId:grant.employeeId,operationId,replayed:true});
   if(grant.state!=='releasing')throw Error('release_not_authorized');
   const released=await admin.auth.admin.updateUserById(op.authId,{password,email_confirm:true,ban_duration:'none',
    app_metadata:{employee_creation_operation:operationId,employee_creation_phase:'released'}});
   if(released.error){
    if([400,422].includes(released.error.status)){
     await advance('release_rejected');
     return reply(409,{error:'Authが入力を受け付けませんでした。隔離を維持しています。初期パスワードの条件を確認して限定復旧してください。',operationId,recoveryRequired:true,passwordRequired:true});
    }
    throw Error('auth_release_unknown');
   }
   if(!released.data?.user)throw Error('auth_release_unknown');
   const done=await advance('complete'); // DB independently checks real auth.users.
   if(done.state!=='completed')throw Error('completion_unknown');
   return reply(200,{success:true,employeeId:done.employeeId,operationId});
  }catch{
   // Never expose/log passwords, JWTs, user payloads or SDK error objects.
   return reply(409,{error:'登録結果を確認できません。別操作で再登録せず、登録状況と限定復旧を確認してください。',operationId,recoveryRequired:true});
  }
 };
}
