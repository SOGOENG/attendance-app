(() => {
 'use strict';
 const $=id=>document.getElementById(id),period=DrivingReportPeriod;
 let authorized=false,busy=false,actorId=null,detailVersion=0;
 const node=(tag,value)=>{const n=document.createElement(tag);n.textContent=value;return n;};
 const labels={future:'未来日・対象外',today:'本日・入力待ち',complete:'提出済み',missing:'未入力',incomplete:'入力未完了',review:'勤務等の要確認',exempt:'入力不要',ready:'入力完了・月別提出待ち'};
 async function rpc(name,body){
  const response=await portalFetch(`${PORTAL_SUPABASE_URL}/rest/v1/rpc/${name}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const data=await response.json().catch(()=>null);
  if(!response.ok)throw Error(response.status===403||data?.message==='admin_required'?'全体管理者のみ閲覧できます。':response.status===404||data?.code==='PGRST202'?'管理者用SQLが未適用です。管理者に確認してください。':'読取権限またはデータを確認できません。再読み込みしてください。');
  return data;
 }
 function controls(){for(const id of ['statusMonth','reloadStatus'])$(id).disabled=busy||!authorized;$('viewOwnStatus').disabled=busy||!authorized||actorId===null;}
 function checkPeriod(data,month){const span=period.range(month);if(data?.closing_month!==month+'-01'||data.period_start!==span.start||data.period_end!==span.end)throw Error('対象期間の応答が不正です。');}
 function dateTime(value){return value?new Intl.DateTimeFormat('ja-JP',{timeZone:'Asia/Tokyo',dateStyle:'short',timeStyle:'short'}).format(new Date(value)):'—';}
 async function detail(id){
  const version=++detailVersion,month=$('statusMonth').value;
  $('statusDetail').hidden=false;$('statusDetailTitle').textContent='日別状況';$('statusDays').replaceChildren();$('statusDetailMessage').textContent='読み込み中…';
  try{
   const result=await rpc('admin_driving_month_days',{p_employee_id:id,p_closing_month:month+'-01'});
   if(version!==detailVersion||month!==$('statusMonth').value)return;
   checkPeriod(result,month);
   if(String(result.employee?.id)!==String(id)||!Array.isArray(result.days)||result.days.length!==period.range(month).days.length)throw Error('社員別応答が不正です。');
   $('statusDetailTitle').textContent=`${result.employee.name} ／ ${result.employee.department||'所属未設定'}`;
   $('statusDetailMessage').textContent=`${result.submitted?'月別提出済み':'月別未提出'} ／ 提出日時 ${dateTime(result.submitted_at)}${result.employee.driving_report_required?'':' ／ 現在は対象OFF'}`;
   for(const [index,day] of result.days.entries()){
    if(day.date!==period.range(month).days[index]||!labels[day.kind])throw Error('日別応答が不正です。');
    const reason=day.issue?(DrivingReportMonthFollowup.labels[day.issue]||'日報・勤務等の情報を確認してください'):day.kind==='exempt'?(day.reason==='company_holiday'?'会社休日':'確定した終日休暇'):'';
    $('statusDays').append(node('li',`${day.date}：${labels[day.kind]}${reason?' ／ '+reason:''}`));
   }
  }catch(error){if(version===detailVersion){$('statusDays').replaceChildren();$('statusDetailMessage').textContent=error.message;}}
 }
 async function load(){
  if(busy||!authorized)return;
  busy=true;controls();++detailVersion;$('statusDetail').hidden=true;$('statusDays').replaceChildren();$('statusEmployees').replaceChildren();$('statusMessage').textContent='提出状況を読み込み中…';
  try{
   const month=$('statusMonth').value,span=period.range(month),rows=[];let total=null,rosterToken=null;
   for(let offset=0;;offset+=50){
    const data=await rpc('admin_driving_month_status',{p_closing_month:month+'-01',p_limit:50,p_offset:offset});checkPeriod(data,month);
    if(typeof data.roster_token!=='string'||!/^[a-f0-9]{32}$/.test(data.roster_token)||!Array.isArray(data.employees)||!Number.isSafeInteger(data.total)||data.total<0||!/^\d+$/.test(String(data.actor_id)))throw Error('一覧の応答が不正です。');
    if(total!==null&&(total!==data.total||rosterToken!==data.roster_token))throw Error('対象設定が変更されました。再読み込みしてください。');
    actorId=data.actor_id;total=data.total;rosterToken=data.roster_token;rows.push(...data.employees);
    if(rows.length>=total)break;if(data.employees.length!==50)throw Error('一覧が途中で切れています。');
   }
   if(rows.length!==total||new Set(rows.map(e=>String(e.id))).size!==rows.length)throw Error('対象一覧を確認できません。');
   const fragment=document.createDocumentFragment();
   for(const e of rows){
    if(typeof e.submitted!=='boolean'||['missing','incomplete','review'].some(k=>!Number.isSafeInteger(e[k])||e[k]<0))throw Error('件数の応答が不正です。');
    const tr=node('tr','');tr.dataset.employee=String(e.id);
    for(const value of [`${e.name} ／ ${e.department||'所属未設定'}${e.active?'':'（使用停止）'}`,e.submitted?'提出済み':'未提出',dateTime(e.submitted_at),e.missing+e.incomplete,e.missing,e.incomplete,e.review])tr.append(node('td',String(value)));
    const cell=node('td',''),button=node('button','日別確認');button.type='button';button.onclick=()=>detail(e.id);cell.append(button);tr.append(cell);fragment.append(tr);
   }
   $('statusEmployees').replaceChildren(fragment);$('statusPeriod').textContent=`期間：${span.start}〜${span.end}`;
   $('statusMessage').textContent=rows.length?`対象 ${rows.length}人 ／ 提出済み ${rows.filter(e=>e.submitted).length}人 ／ 未提出 ${rows.filter(e=>!e.submitted).length}人。件数は昨日以前です。`:'対象社員は0人です。対象設定を確認してください。全員提出済みという意味ではありません。';
  }catch(error){$('statusEmployees').replaceChildren();$('statusMessage').textContent=error.message;}
  finally{busy=false;controls();}
 }
 $('statusMonth').onchange=load;$('reloadStatus').onclick=load;$('viewOwnStatus').onclick=()=>detail(actorId);
 (async()=>{try{if(await rpc('is_application_admin',{})!==true)throw Error('全体管理者のみ閲覧できます。');authorized=true;$('statusMonth').value=period.closingMonth();await load();}catch(error){$('statusMessage').textContent=error.message;}finally{controls();}})();
})();
