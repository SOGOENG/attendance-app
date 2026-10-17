(() => {
 'use strict';
 const $=id=>document.getElementById(id),api=FuelReceipts.api;let access,busy=false;
 const el=(tag,text)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;return node;};
 const msg=(text,error=false)=>{$('receiptAdminMessage').textContent=text;$('receiptAdminMessage').classList.toggle('is-error',error);};
 async function task(fn){if(busy)return;busy=true;try{await fn();}catch(error){msg(error.message,true);}finally{busy=false;}}
 function button(parent,label,handler){const node=el('button',label);node.type='button';node.onclick=()=>task(handler);parent.append(node);return node;}
 async function showReceipt(id){const win=window.open('about:blank','_blank');if(win)win.opener=null;try{const result=await api('view',{id});if(win)win.location=result.url;else msg('ブラウザのポップアップを許可して再度お試しください。',true);}catch(error){win?.close();throw error;}}
 let employees=[];
 async function masterRows(path){
  const rows=[];
  for(let offset=0;;offset+=500){
   const response=await portalFetch(`${PORTAL_SUPABASE_URL}/rest/v1/${path}&limit=500&offset=${offset}`);
   if(!response.ok)throw Error('検索用マスタを取得できません。閲覧権限を確認して再読み込みしてください。');
   const page=await response.json();if(!Array.isArray(page))throw Error('検索用マスタの応答を確認できません。');
   rows.push(...page);if(page.length<500)return rows;
  }
 }
 function options(id,all,rows){
  const select=$(id),previous=select.value;select.replaceChildren(new Option(all,''));
  for(const [value,label] of rows)select.add(new Option(label,String(value)));
  select.value=[...select.options].some(o=>o.value===previous)?previous:'';
 }
 function employeeOptions(){
  const department=$('receiptDepartment').value;
  options('receiptEmployee','すべての社員',employees.filter(e=>!department||e.department===department).map(e=>[e.id,`${e.name}${e.active===false?'（退職・無効）':''}`]));
 }
 async function loadMasters(){
  const [people,vehicles]=await Promise.all([masterRows('employees?select=id,name,department,active&order=department.asc,name.asc,id.asc'),masterRows('vehicles?select=id,vehicle_number,vehicle_name,active&order=vehicle_number.asc,id.asc')]);
  employees=people;
  options('receiptDepartment','すべての部署',[...new Set(people.map(e=>e.department).filter(Boolean))].map(d=>[d,d]));
  employeeOptions();
  const counts=new Map();for(const v of vehicles)counts.set(v.vehicle_number,(counts.get(v.vehicle_number)||0)+1);
  options('receiptVehicle','すべての車両',vehicles.map(v=>[v.id,`${v.vehicle_number}${counts.get(v.vehicle_number)>1?` ／ ${v.vehicle_name||'名称なし'}（ID ${v.id}）`:''}${v.active===false?'（無効）':''}`]));
 }
 $('receiptDepartment').onchange=employeeOptions;
 async function refresh(){
  const filters={month:$('receiptMonth').value};
  if(!/^\d{4}-\d{2}$/.test(filters.month))throw Error('対象年月を選択してください。');
  if($('receiptEmployee').value)filters.employee_id=Number($('receiptEmployee').value);
  if($('receiptVehicle').value)filters.vehicle_id=Number($('receiptVehicle').value);
  if($('receiptReceived').value!=='')filters.received=$('receiptReceived').value==='true';
  filters.missing=$('receiptMissing').checked;
  const [monthlyRows,history]=await Promise.all([api('list',filters),api('exports')]);
  const department=$('receiptDepartment').value;
  const members=new Set(employees.filter(e=>e.department===department).map(e=>String(e.id)));
  const rows=department?monthlyRows.filter(row=>members.has(String(row.employee_id))):monthlyRows;
  $('receiptList').replaceChildren();
  let bytes=0;for(const row of rows){
   bytes+=['active','deleting'].includes(row.state)?Number(row.bytes||0):0;
   const card=el('article');card.className='receipt-item';card.append(el('h3',`${row.fuel_date}　${row.employee_name}`),el('p',`車両：${row.vehicle||'未設定'} ／ ${row.liters} L ／ ${row.odometer_km??'—'} km`),el('p',`原本：${row.received?'受領済み':'未受領'} ${row.received_at||''} ${row.received_by||''}`));
   const controls=el('div');controls.className='receipt-actions';
   if(row.state==='active')button(controls,'領収書を拡大表示',()=>showReceipt(row.receipt_id));
   else card.append(el('p',row.state==='archived'?'領収書画像はアーカイブ済み':row.state==='deleting'?'削除処理中・再試行が必要':'領収書未添付'));
   button(controls,row.received?'原本受領を取り消す':'原本受領済みにする',async()=>{if(!confirm(row.received?'原本受領を取り消して訂正しますか？':'紙の原本を受け取りましたか？'))return;await api('review',{refuel_id:row.refuel_id,received:!row.received});await refresh();msg('原本受領状態を記録しました。');});
   card.append(controls);$('receiptList').append(card);
  }
  $('receiptUsage').textContent=`表示 ${rows.length}件 ／ 保存画像 ${rows.filter(r=>r.state==='active').length}件・${Math.round(bytes/1024)}KB　全保存容量 ${Math.round(history.bytes/1024/1024)}MB / 上限800MB`;
  const jobs=history.jobs;
  $('receiptBackupStatus').textContent=jobs.length
   ? `取得した出力履歴 ${jobs.length}件 ／ バックアップ未確認 ${jobs.filter(j=>!j.backup_checked_at).length}件 ／ 削除未承認 ${jobs.filter(j=>!j.approved_at).length}件`
   : '出力履歴はありません';
  $('receiptJobs').replaceChildren();for(const job of jobs)renderJob(job);
  $('receiptAudit').replaceChildren(...history.audit.map(a=>el('p',`${a.happened_at} ／ 社員ID ${a.actor_id} ／ ${a.event} ／ ${a.target||''}`)));
  msg(`${rows.length}件を表示しました。`);
 }
 function field(parent,label,type='text'){const wrap=el('label',label),input=el('input');input.type=type;wrap.append(input);parent.append(wrap);return input;}
 function renderJob(job){
  const card=el('article');card.className='receipt-job';
  const candidates=job.candidates||[];
  const size=candidates.reduce((n,c)=>n+c.bytes,0);
  card.append(el('h3',`${job.month.slice(0,7)} ／ ${job.state}`),el('p',`実行 ${job.created_at} ／ 実行者ID ${job.actor_id} ／ 対象 ${job.manifest.files.length}ファイル`),el('p',`1年経過候補 ${candidates.length}件・${Math.ceil(size/1024)}KB`),el('p',`バックアップ：${job.backup_location||'未確認'} ／ 削除承認：${job.approved_at||'未承認'}`));
  if(job.error)card.append(el('p',`失敗：${job.error}`));
  if(job.state==='generated')button(card,'ZIP保存完了を確認',async()=>{if(!confirm('ZIPを保存し、開けることを確認しましたか？これは会社側バックアップの確認とは別です。'))return;await api('export_downloaded',{export_id:job.id});await refresh();});
  if(job.state==='downloaded'){
   const location=field(card,'会社管理の保存先（フォルダ・管理番号）');
   const proof=field(card,'照合スクリプトのbackup-verification.json','file');proof.accept='.json,application/json';
   const legal=field(card,'保存義務・社内ルールを確認し、会社管理先で保存を継続する','checkbox');
   button(card,'バックアップ件数・整合性の確認を記録',async()=>{
    if(!proof.files[0]||!legal.checked||location.value.trim().length<3)throw Error('保存先・照合結果・保存義務の確認が必要です。');
    if(proof.files[0].size>2*1024*1024)throw Error('照合結果が大きすぎます。');
    const report=JSON.parse(await proof.files[0].text());if(report.export_id!==job.id)throw Error('ZIPの照合対象が一致しません。');
    await api('backup',{export_id:job.id,location:location.value.trim(),legal_checked:true,verified_files:report.files});await refresh();
   });
   if(access.admin&&job.backup_checked_at)button(card,'画像削除を承認',async()=>{if(!confirm('会社側の保存と整合性・保存義務を確認したこのZIPの削除を承認しますか？'))return;await api('approve',{export_id:job.id});await refresh();});
   if(access.admin&&job.approved_at&&candidates.length)button(card,'1年経過ファイルを削除（最大25件ずつ）',async()=>{
    if(!confirm(`${candidates.length}件・${Math.ceil(size/1024)}KBを削除します。会社管理先で原本ファイルを保管し続けますか？日報・給油データは削除しません。`))return;
    const results=[];for(let i=0;i<candidates.length;i+=25)results.push(...await api('archive',{export_id:job.id,ids:candidates.slice(i,i+25).map(c=>c.id)}));
    await refresh();msg(`削除成功 ${results.filter(x=>x.success).length}件／失敗 ${results.filter(x=>!x.success).length}件。失敗分は再試行できます。`,results.some(x=>!x.success));
   });
  }
  $('receiptJobs').append(card);
 }
 async function download(){
  const month=$('receiptMonth').value;if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))throw Error('対象年月を選択してください。');let writable;
  if(window.showSaveFilePicker){const file=await window.showSaveFilePicker({suggestedName:`fuel-receipts-${month}.zip`,types:[{description:'ZIP',accept:{'application/zip':['.zip']}}]});writable=await file.createWritable();}
  const response=await portalFetch(`${PORTAL_SUPABASE_URL}/functions/v1/fuel-receipts`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'export',data:{month}})});
  if(!response.ok){await writable?.abort();throw Error((await response.json()).error||'ZIPを作成できません。');}
  const exportId=response.headers.get('X-Receipt-Export'),reader=response.body.getReader(),parts=[];let size=0;
  try{
   for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(writable)await writable.write(value);else{if(size>64*1024*1024)throw Error('このブラウザでは64MBを超えるZIPを保存できません。保存先を指定できるPC版Chrome等を使用してください。');parts.push(value);}}
   if(writable)await writable.close();else{const url=URL.createObjectURL(new Blob(parts,{type:'application/zip'}));const a=el('a');a.href=url;a.download=`fuel-receipts-${month}.zip`;a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);}
  }catch(error){await reader.cancel().catch(()=>{});await writable?.abort().catch(()=>{});if(exportId)await api('export_failed',{export_id:exportId,error:error.message}).catch(()=>{});throw error;}
  if(confirm('ZIPの保存が完了し、保存先にファイルがあることを確認しましたか？会社側バックアップ確認は別途必要です。'))await api('export_downloaded',{export_id:exportId});
  await refresh();msg('ZIPを作成しました。会社管理先へのバックアップと照合は別途必要です。');
 }
 $('receiptFilters').onsubmit=e=>{e.preventDefault();void task(refresh);};$('receiptExport').onclick=()=>task(download);
 void task(async()=>{access=await api('access');if(!access.manager)throw Error('給油領収書管理は経理担当者・全体管理者のみ利用できます。');await loadMasters();$('receiptAdminContent').hidden=false;$('receiptMonth').value=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit'}).format(new Date());await refresh();});
})();
