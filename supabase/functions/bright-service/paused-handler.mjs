// Minimal production entry: no employee/Auth writes and no creation-operation RPCs.
// The experimental operation/recovery handler remains separate and is not imported.
const cors = {'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS'};
const reply=(status,body)=>new Response(JSON.stringify(body),{status,headers:{...cors,'Content-Type':'application/json'}});
export function createHandler({createClient,env}) {
 return async req=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:cors});
  if(req.method!=='POST')return reply(405,{error:'POSTで実行してください'});
  try {
   const url=env('SUPABASE_URL'),anon=env('SUPABASE_ANON_KEY'),key=env('SUPABASE_SERVICE_ROLE_KEY');
   if(!url||!anon||!key)return reply(500,{error:'サーバー設定を確認してください'});
   const authorization=req.headers.get('Authorization');
   if(!/^Bearer\s+\S+$/i.test(authorization||''))return reply(401,{error:'ログイン情報がありません'});
   const user=createClient(url,anon,{global:{headers:{Authorization:authorization}}});
   const {data,error}=await user.auth.getUser();
   if(error||!data?.user)return reply(401,{error:'ログイン情報を確認できません'});
   const admin=createClient(url,key,{auth:{autoRefreshToken:false,persistSession:false}});
   const actor=await admin.from('employees').select('id,active,admin_scope,auth_user_id').eq('auth_user_id',data.user.id).maybeSingle();
   if(actor.error)return reply(503,{error:'管理者情報を確認できません'});
   if(!actor.data||actor.data.active!==true||actor.data.admin_scope!=='all')return reply(403,{error:'全体管理者のみ操作できます'});
   let body;try{body=await req.json();}catch{return reply(400,{error:'JSON形式で送信してください'});}
   if(!body||Array.isArray(body)||typeof body!=='object')return reply(400,{error:'入力形式が不正です'});
   const action=body.action??'create';
   if(action==='delete')return reply(403,{code:'employee_delete_disabled',error:'完全削除は停止中です。使用停止を利用してください。'});
   if(action==='create')return reply(503,{code:'employee_creation_paused',creationEnabled:false,error:'社員登録は停止中です。既存社員の編集は利用できます。'});
   if(action==='creation_status')return reply(503,{code:'employee_creation_management_not_installed',error:'登録操作管理は今回の導入対象外です。既存の未完了記録は削除せず管理者へ連絡してください。'});
   return reply(400,{error:'不正な操作です'});
  } catch {
   // Do not log JWTs, passwords, SDK errors or request data.
   return reply(503,{error:'認証・管理者情報を確認できません'});
  }
 };
}
