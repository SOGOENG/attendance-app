(() => {
 'use strict';
 const integrated=!!document.getElementById('integratedDrivingStatus');
 const $=id=>document.getElementById(integrated&&id==='statusMonth'?'closingMonth':id),period=DrivingReportPeriod;
 let authorized=false,busy=false,actorId=null,detailVersion=0;
 const node=(tag,value)=>{const n=document.createElement(tag);n.textContent=value;return n;};
 const labels={future:'未来日・対象外',today:'本日・入力待ち',complete:'提出済み',missing:'未入力',incomplete:'入力未完了',review:'勤務等の要確認',exempt:'入力不要',ready:'入力完了・月別提出待ち'};
 async function rpc(name,body){
  const response=await portalFetch(`${PORTAL_SUPABASE_URL}/rest/v1/rpc/${name}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const data=await response.json().catch(()=>null);
  if(!response.ok)throw Error(response.status===403||data?.message==='admin_required'?'全体管理者のみ閲覧できます。':response.status===404||data?.code==='PGRST202'?'管理者用SQLが未適用です。管理者に確認してください。':'読取権限またはデータを確認できません。再読み込みしてください。');
  return data;
 }
 function controls(){if(integrated)return;for(const id of ['statusMonth','reloadStatus'])$(id).disabled=busy||!authorized;$('viewOwnStatus').disabled=busy||!authorized||actorId===null;}
 function back(){++detailVersion;$('statusDetail').hidden=true;if(integrated){$('statusList').hidden=false;$('statusEmployees').querySelector('button')?.focus();}}
 function checkPeriod(data,month){const span=period.range(month);if(data?.closing_month!==month+'-01'||data.period_start!==span.start||data.period_end!==span.end)throw Error('対象期間の応答が不正です。');}
 function dateTime(value){return value?new Intl.DateTimeFormat('ja-JP',{timeZone:'Asia/Tokyo',dateStyle:'short',timeStyle:'short'}).format(new Date(value)):'—';}
 async function readAll(table,query){
  const rows=[];let total=null;
  for(let offset=0;;){
   const response=await portalFetch(`${PORTAL_SUPABASE_URL}/rest/v1/${table}?${query}&limit=100&offset=${offset}`,{headers:{Prefer:'count=exact'}});
   if(!response.ok)throw Error('社員一覧または提出記録を取得できません。再読み込みしてください。');
   const page=await response.json(),count=response.headers.get('Content-Range')?.match(/\/(\d+)$/);
   if(!Array.isArray(page)||!count)throw Error('一覧の全件取得を確認できません。');
   if(total!==null&&total!==Number(count[1]))throw Error('一覧が変更されました。再読み込みしてください。');
   total=Number(count[1]);rows.push(...page);offset+=page.length;
   if(rows.length===total)return rows;
   if(!page.length||rows.length>total)throw Error('一覧が途中で切れています。');
  }
 }
 async function allEmployeeStatus(month){
  const [employees,submissions]=await Promise.all([
   readAll('employees','select=id,name,department,active,driving_report_required&order=id.asc'),
   readAll('driving_report_month_submissions',`select=employee_id,closing_month&closing_month=eq.${month}-01&order=employee_id.asc`)
  ]);
  if(new Set(employees.map(e=>String(e.id))).size!==employees.length||new Set(submissions.map(e=>String(e.employee_id))).size!==submissions.length)throw Error('一覧が重複しています。');
  if(submissions.some(s=>s.closing_month!==month+'-01'))throw Error('提出記録の対象月が不正です。');
  const submitted=new Set(submissions.map(e=>String(e.employee_id)));
  return employees.map(e=>{
   if(!/^\d+$/.test(String(e.id))||typeof e.name!=='string'||typeof e.driving_report_required!=='boolean')throw Error('社員一覧の応答が不正です。');
   return {...e,submitted:submitted.has(String(e.id)),missing:0,incomplete:0,review:0};
  }).sort((a,b)=>(a.department||'所属未設定').localeCompare(b.department||'所属未設定','ja')||String(a.id).localeCompare(String(b.id),undefined,{numeric:true}));
 }
 async function detail(id){
  const version=++detailVersion,month=$('statusMonth').value;
  $('statusDetail').hidden=false;$('statusDetailTitle').textContent='日別状況';$('statusDays').replaceChildren();$('statusDetailMessage').textContent='読み込み中…';
  if(integrated){$('statusList').hidden=true;$('statusDetailTitle').focus();}
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
    $('statusDays').append(node('li',`${day.date}：${labels[day.kind]}${day.status==='draft'?' ／ 下書き':''}${reason?' ／ '+reason:''}`));
   }
  }catch(error){if(version===detailVersion){$('statusDays').replaceChildren();$('statusDetailMessage').textContent=error.message;}}
 }
 async function load(){
  if(!authorized)return;
  const month=$('statusMonth').value,version=++detailVersion;
  if(!month)return;
  busy=true;controls();$('statusDetail').hidden=true;if(integrated)$('statusList').hidden=false;$('statusDays').replaceChildren();$('statusEmployees').replaceChildren();$('statusMessage').textContent='提出状況を読み込み中…';
  try{
   const span=period.range(month),rows=[];let total=null,rosterToken=null;
   if(integrated){rows.push(...await allEmployeeStatus(month));total=rows.length;if(version!==detailVersion||month!==$('statusMonth').value)return;}
   else for(let offset=0;;offset+=50){
    const data=await rpc('admin_driving_month_status',{p_closing_month:month+'-01',p_limit:50,p_offset:offset});checkPeriod(data,month);
    if(version!==detailVersion||month!==$('statusMonth').value)return;
    if(typeof data.roster_token!=='string'||!/^[a-f0-9]{32}$/.test(data.roster_token)||!Array.isArray(data.employees)||!Number.isSafeInteger(data.total)||data.total<0||!/^\d+$/.test(String(data.actor_id)))throw Error('一覧の応答が不正です。');
    if(total!==null&&(total!==data.total||rosterToken!==data.roster_token))throw Error('対象設定が変更されました。再読み込みしてください。');
    actorId=data.actor_id;total=data.total;rosterToken=data.roster_token;rows.push(...data.employees);
    if(rows.length>=total)break;if(data.employees.length!==50)throw Error('一覧が途中で切れています。');
   }
   if(rows.length!==total||new Set(rows.map(e=>String(e.id))).size!==rows.length)throw Error('対象一覧を確認できません。');
   const fragment=document.createDocumentFragment(),departments=new Map();
   for(const e of rows){
    if(typeof e.submitted!=='boolean'||['missing','incomplete','review'].some(k=>!Number.isSafeInteger(e[k])||e[k]<0))throw Error('件数の応答が不正です。');
    if(integrated){
     const department=e.department||'所属未設定';
     if(!departments.has(department)){
      const group=node('div',''),heading=node('h3',department),list=node('div','');
      const members=rows.filter(employee=>(employee.department||'所属未設定')===department);
      heading.textContent=`${department}（${members.filter(employee=>employee.submitted).length} / ${members.length}人）`;
      group.className='csv-department';heading.className='admin-department-title';list.className='csv-department-employees';group.append(heading,list);fragment.append(group);departments.set(department,list);
     }
     const card=node('button',''),text=node('span',''),name=node('span',e.name),meta=node('span',`ID ${e.id}${e.active?'':' ／ 使用停止'}${e.driving_report_required?'':' ／ 対象外（提出義務なし）'}`),badge=node('span',e.submitted?'提出済み':'未提出');
     card.type='button';card.onclick=()=>detail(e.id);card.className=`employee-row employee-status-button csv-employee ${e.submitted?'status-submitted':'status-not-saved'}`;text.className='csv-employee-text';name.className='employee-status-name';meta.className='csv-employee-meta';badge.className=`employee-status-text csv-employee-status ${e.submitted?'is-submitted':'is-missing'}`;
     text.append(name,meta);card.append(text,badge);departments.get(department).append(card);continue;
    }
    const tr=node('tr','');tr.dataset.employee=String(e.id);
    for(const value of [`${e.name} ／ ${e.department||'所属未設定'}${e.active?'':'（使用停止）'}`,e.submitted?'提出済み':'未提出',dateTime(e.submitted_at),e.missing+e.incomplete,e.missing,e.incomplete,e.review])tr.append(node('td',String(value)));
    const cell=node('td',''),button=node('button','日別確認');button.type='button';button.onclick=()=>detail(e.id);cell.append(button);tr.append(cell);fragment.append(tr);
   }
   $('statusEmployees').replaceChildren(fragment);$('statusPeriod').textContent=`期間：${span.start}〜${span.end}`;
   $('statusMessage').textContent=integrated?(rows.length?`${rows.filter(e=>e.submitted).length} / ${rows.length}人 提出済み`:'社員は0人です。全員提出済みという意味ではありません。'):(rows.length?`対象 ${rows.length}人 ／ 提出済み ${rows.filter(e=>e.submitted).length}人 ／ 未提出 ${rows.filter(e=>!e.submitted).length}人。件数は昨日以前です。`:'対象社員は0人です。対象設定を確認してください。全員提出済みという意味ではありません。');
  }catch(error){if(version===detailVersion){$('statusEmployees').replaceChildren();$('statusMessage').textContent=error.message;}}
  finally{if(version===detailVersion){busy=false;controls();}}
 }
 if(integrated){document.addEventListener('driving-csv-month-change',load);$('backToStatusList').onclick=back;}
 else{$('statusMonth').onchange=load;$('reloadStatus').onclick=load;$('viewOwnStatus').onclick=()=>detail(actorId);}
 (async()=>{try{if(await rpc('is_application_admin',{})!==true)throw Error('全体管理者のみ閲覧できます。');authorized=true;if(!integrated)$('statusMonth').value=period.closingMonth();await load();}catch(error){$('statusMessage').textContent=error.message;}finally{controls();}})();
})();
