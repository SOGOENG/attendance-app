(() => {
 'use strict';
 const field=document.getElementById('fuelReceiptRoleField'),select=document.getElementById('employeeFuelReceiptRole'),message=document.getElementById('fuelReceiptRoleMessage');
 let generation=0,state=null;
 function close(){++generation;state=null;field.hidden=true;select.disabled=true;select.value='none';message.textContent='';}
 function open(id){
  close();const version=generation;
  const current={id:String(id),admin:false,loaded:false,initial:null};state=current;
  current.ready=(async()=>{
   try{
    const access=await FuelReceipts.api('access');if(version!==generation)return;
    current.admin=access.admin===true;if(!current.admin)return;
    field.hidden=false;message.textContent='権限を読み込み中…';
    const rows=await FuelReceipts.api('roles');if(version!==generation)return;
    const row=rows.find(r=>String(r.id)===String(id));
    if(!row){message.textContent='使用停止中の社員など、権限を取得できない社員の設定は変更できません。';current.loaded=true;return;}
    current.initial=row.accounting===true;current.loaded=true;
    select.value=current.initial?'accounting':'none';select.disabled=false;message.textContent='';
   }catch{if(version!==generation)return;current.failed=true;field.hidden=false;message.textContent='権限を取得できません。編集を開き直して確認してください。';}
  })();
 }
 async function prepare(id){
  const current=state;if(!current||current.id!==String(id))return null;
  await current.ready;
  if(state!==current)throw Error('編集中の社員が変更されました。');
  if(current.failed)throw Error('給油領収書管理権限を取得できません。編集を開き直してください。');
  if(!current.admin||current.initial===null)return null;
  const enabled=select.value==='accounting';if(enabled===current.initial)return null;
  if(enabled&&document.getElementById('employeeActive').value!=='true')throw Error('経理担当者を追加する場合は社員を使用中にしてください。');
  return {id:current.id,enabled,current};
 }
 async function save(change){
  if(!change)return;
  // SQL rechecks full administrator privileges; no direct table writes.
  await FuelReceipts.api('roles',{employee_id:Number(change.id),enabled:change.enabled});
  change.current.initial=change.enabled;
 }
 window.EmployeeFuelReceiptRole={open,close,prepare,save};
})();
