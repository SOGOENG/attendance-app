(() => {
 'use strict';
 const $=id=>document.getElementById(id),period=DrivingReportPeriod,monthly=DrivingReportMonthMode;
 let employeeId=null,requestNumber=0,submitBusy=false,currentCheck=null,displayedRows=new Map();
 const text=(tag,value)=>{const node=document.createElement(tag);node.textContent=value;return node;};
 function message(value,error=false){$('monthlyMessage').textContent=value;$('monthlyMessage').classList.toggle('is-error',error);}
 async function request(path,options){const response=await portalFetch(`${PORTAL_SUPABASE_URL}/rest/v1/${path}`,options);if(!response.ok)throw Error('本人の日報を取得できません。再読み込みしてください。');return response.json();}
 async function all(path){
  const result=[];
  for(let offset=0;;offset+=500){const rows=await request(`${path}&limit=500&offset=${offset}`);if(!Array.isArray(rows))throw Error('応答が不正です。');result.push(...rows);if(rows.length<500)return result;}
 }
 async function workSources(span){
  const sources=await Promise.allSettled([
   all(`holidays?select=date,day_type&date=gte.${span.start}&date=lt.${span.endExclusive}&order=date.asc,id.asc`),
   all(`attendance?select=employee_id,work_date,site_type,leave_type,status,source_type,source_application_id&employee_id=eq.${employeeId}&work_date=gte.${span.start}&work_date=lt.${span.endExclusive}&order=work_date.asc,id.asc`),
   all(`applications?select=id,employee_id,status,application_type,paid_leave_application_details(start_date,end_date,days,day_part),comp_leave_application_details(comp_leave_dates(leave_date,days))&employee_id=eq.${employeeId}&status=eq.approved&application_type=in.(paid_leave,comp_leave)&order=id.asc`)
  ]);
  return sources.map((source,index)=>source.status==='fulfilled'?source.value.filter(row=>index===0||String(row.employee_id)===String(employeeId)):null);
 }
 function controls(loading){for(const id of ['closingMonth','reloadMonth'])$(id).disabled=loading||submitBusy||employeeId===null;
  $('submitMonth').disabled=loading||submitBusy||!monthly.enabled||!currentCheck||currentCheck.already_submitted||!currentCheck.eligible||(monthly.firstMonth&&$('closingMonth').value<monthly.firstMonth)||period.today()<period.range($('closingMonth').value).endExclusive;
 }
 const issueLabels=DrivingReportMonthFollowup.labels;
 function filterDays(){
  const only=$('onlyActionNeeded').checked&&!$('onlyActionNeeded').disabled;
  const rows=[...$('monthlyDays').children];
  for(const row of rows)row.hidden=only&&row.dataset.action!=='true';
  $('monthlyFilterMessage').textContent=only?`要対応 ${rows.filter(row=>!row.hidden).length}日（昨日以前）`:'';
 }
 $('onlyActionNeeded').onchange=filterDays;
 function refreshFollowups(checked,now){
  const counts={missing:0,incomplete:0,review:0},days=new Map((checked?.days||[]).map(day=>[day.date,day]));
  const labels={missing:'未入力',incomplete:'入力未完了',review:'勤務等の要確認',today:'本日',future:'対象外',complete:'確認済み',exempt:'入力不要',ready:'入力完了',unavailable:'未判定'};
  for(const item of $('monthlyDays').children){
   const result=DrivingReportMonthFollowup.classify(item.dataset.date,now,days.get(item.dataset.date),checked?.errors||[],displayedRows.get(item.dataset.date),checked?.already_submitted);
   item.dataset.followup=result.kind;item.dataset.action=String(result.action);
   item.querySelector('.monthly-followup').textContent=`${labels[result.kind]}：${result.reason}`;
   if(result.action)counts[result.kind]++;
  }
  $('onlyActionNeeded').disabled=!checked;
  $('monthlyFollowupCounts').textContent=checked?`記入忘れ ${counts.missing+counts.incomplete}日（未入力 ${counts.missing}日／入力未完了 ${counts.incomplete}日）／勤務等の要確認 ${counts.review}日（昨日以前）`:'記入忘れは未判定です（月別確認を利用できません）。';
  filterDays();
 }
 function submissionInfo(checked,showIssues=false){
  $('monthSubmitIssues').replaceChildren();
  const issues=checked.already_submitted?[]:[...new Map(checked.errors.map(issue=>[issue.date+':'+issue.code,issue])).values()];
  for(const issue of issues){const item=text('li',''),link=text('a',`${issue.date}：${issueLabels[issue.code]||'日報の入力内容を確認してください'}`);if(issue.date<=period.today()){link.href=monthly.link(issue.date);item.append(link);}else item.textContent=link.textContent+'（未来日）';$('monthSubmitIssues').append(item);}
  const perDay=new Map();
  for(const issue of issues){if(!perDay.has(issue.date))perDay.set(issue.date,new Set());perDay.get(issue.date).add(issue.code);}
  const missing=[...perDay.values()].filter(codes=>codes.size===1&&codes.has('report_missing')).length;
  $('monthSubmitSummary').textContent=checked.already_submitted?'':`提出時の全期間確認：${perDay.size}日（未入力 ${missing}日／未完了・要確認 ${perDay.size-missing}日）`;
  $('monthSubmitDetails').hidden=perDay.size===0;
  if(showIssues&&perDay.size)$('monthSubmitDetails').open=true;
  $('submitMonth').textContent=checked.already_submitted?'月別提出済み':`${Number($('closingMonth').value.slice(5))}月分をまとめて提出`;
  $('monthSubmitMessage').textContent=checked.already_submitted?'この月は提出済みです。日報の追加・変更はできません。':!checked.eligible||period.today()<period.range($('closingMonth').value).endExclusive?'締め日の翌21日から提出できます。':checked.valid?'提出前に保存内容を確認してください。提出後は編集できません。':'不足日報・未完了・要確認の日があります。内容を確認してください。';
  if(!checked.already_submitted&&monthly.firstMonth&&$('closingMonth').value<monthly.firstMonth)$('monthSubmitMessage').textContent='月別提出は2026年10月分（9/21〜10/20）から利用できます。';
  if($('monthlyDays').children.length)refreshFollowups(checked,period.today());
 }
 $('submitMonth').onclick=async()=>{
  if(submitBusy||!monthly.enabled||!currentCheck||currentCheck.already_submitted)return;
  const month=$('closingMonth').value,span=period.range(month);
  if(period.today()<span.endExclusive||(monthly.firstMonth&&month<monthly.firstMonth))return;
  submitBusy=true;controls(true);$('monthSubmitMessage').textContent='提出内容を確認中…';
  try{
   currentCheck=monthly.validCheck(await monthly.rpc('check_driving_report_month',month),month);submissionInfo(currentCheck,true);
   if(currentCheck.already_submitted){await load();return;}
   if(!currentCheck.eligible||!currentCheck.valid)return;
   if(!window.confirm(`${Number(month.slice(0,4))}年${Number(month.slice(5))}月分をまとめて提出しますか？提出後は編集できません。`))return;
   const result=await monthly.rpc('submit_driving_report_month',month);
   if(!/^\d+$/.test(String(result.id))||String(result.employee_id)!==String(employeeId)||result.closing_month!==month+'-01'||result.period_start!==span.start||result.period_end!==span.end||!result.submitted_at||!Number.isFinite(Date.parse(result.submitted_at)))throw Error('提出結果を確認できません。再読み込みして提出状態を確認してください。');
   await load();
  }catch(error){
   if(error.message==='driving_month_validation_failed'){
    try{currentCheck=monthly.validCheck(await monthly.rpc('check_driving_report_month',month),month);submissionInfo(currentCheck,true);if(currentCheck.valid&&!currentCheck.already_submitted)$('monthSubmitMessage').textContent='保存内容が変わりました。内容を確認してから、もう一度提出してください。';}
    catch{currentCheck=null;$('monthSubmitMessage').textContent='提出状態を確認できません。再読み込みしてください。';}
   }else{currentCheck=null;$('monthSubmitMessage').textContent=monthly.conflict(error)?monthly.conflictMessage:'提出が完了したことを確認できません。再読み込みしてください。';}
  }
  finally{submitBusy=false;controls(false);}
 };

 async function load(){
  const version=++requestNumber;currentCheck=null;controls(true);$('monthSubmitIssues').replaceChildren();$('monthSubmitDetails').open=false;$('monthSubmitDetails').hidden=true;$('monthSubmitSummary').textContent='';$('submitMonth').textContent=monthly.enabled?'確認中…':'準備中';$('monthSubmitMessage').textContent=monthly.enabled?'月別提出状態を確認中…':'この接続先では月別提出を利用できません。';$('monthlyCounts').textContent='';$('monthlyFollowupCounts').textContent='';$('onlyActionNeeded').disabled=true;$('monthlyFilterMessage').textContent='';$('monthlyDays').replaceChildren();message('日報を読み込み中…');
  try{
   const month=$('closingMonth').value,span=period.range(month),now=period.today();
   const crossYear=span.start.slice(0,4)!==span.end.slice(0,4);
   const shortDate=date=>{const [year,m,d]=date.split('-');return `${crossYear?year+'/':''}${Number(m)}/${Number(d)}`;};
   $('monthlyPeriod').textContent=`期間：${shortDate(span.start)}〜${shortDate(span.end)}`;
   $('todayReport').href=monthly.link(now);
   const records=[];
   for(let offset=0;;offset+=500){
    const rows=await request(`driving_reports?select=id,employee_id,report_date,status,driving_status&employee_id=eq.${employeeId}&report_date=gte.${span.start}&report_date=lt.${span.endExclusive}&order=report_date.asc,id.asc&limit=500&offset=${offset}`);
    if(version!==requestNumber)return;if(!Array.isArray(rows))throw Error('日報一覧の応答が不正です。');records.push(...rows);if(rows.length<500)break;
   }
   const [holidays,attendance,applications]=await workSources(span);
   if(version!==requestNumber)return;
   if(monthly.enabled){currentCheck=monthly.validCheck(await monthly.rpc('check_driving_report_month',month),month);if(version!==requestNumber)return;submissionInfo(currentCheck);}
   const byDate=new Map();
   for(const row of records){
    if(String(row.employee_id)!==String(employeeId)||!span.days.includes(row.report_date))continue;
    if(!['draft','submitted'].includes(row.status)||byDate.has(row.report_date))throw Error('日報の状態を確認できません。再読み込みしてください。');byDate.set(row.report_date,row);
   }
   const counts={submitted:0,draft:0,missing:0},fragment=document.createDocumentFragment();
   for(const date of span.days){
    const row=byDate.get(date),future=date>now,state=future?'future':row?.status||'missing';if(!future)counts[state]++;
    const item=text('li','');item.className='monthly-day';item.dataset.date=date;item.dataset.state=state;
    const info=text('div',''),weekday=new Intl.DateTimeFormat('ja-JP',{weekday:'short',timeZone:'UTC'}).format(new Date(`${date}T00:00:00Z`));
    const label=state==='future'?'未来日':state==='submitted'?'提出済み':state==='draft'?'下書き':'記録なし';
    info.append(text('strong',`${date}（${weekday}）${date===now?' 本日':''}`),text('p',`${label}${state==='submitted'&&row.driving_status==='no_driving'?'（運転なし）':''}`));const calendar=text('p',DrivingReportWorkday.calendar(date,holidays));calendar.className='monthly-calendar';
    const checkedDay=currentCheck?.days.find(day=>day.date===date);
    const assessment=checkedDay?DrivingReportWorkday.fromCheck(checkedDay,now,row):DrivingReportWorkday.assess(date,now,row,attendance,applications),work=text('p',assessment.text);work.className='monthly-work';item.dataset.work=assessment.state;
    calendar.hidden=true;work.hidden=true;
    const followup=text('p','');followup.className='monthly-followup';info.append(followup);
    const holiday=Array.isArray(holidays)&&holidays.filter(h=>h.date===date).length===1&&holidays.some(h=>h.date===date&&['休日','祝日'].includes(h.day_type));
    item.classList.toggle('is-company-holiday',holiday);info.append(calendar,work);item.append(info);
    if(future||currentCheck?.already_submitted&&!row)item.append(text('span',future?'入力不可':'月別提出済み'));
    else{const link=text('a',state==='submitted'||currentCheck?.already_submitted?'詳細確認':state==='draft'?'続きから入力':holiday?'休日出勤':'新規入力');if(link.textContent==='休日出勤')link.classList.add('monthly-holiday-work');link.href=monthly.link(date);item.append(link);}
    fragment.append(item);
   }
   displayedRows=byDate;$('monthlyDays').replaceChildren(fragment);refreshFollowups(currentCheck,now);$('monthlyCounts').textContent=`提出済み ${counts.submitted}件 ／ 下書き ${counts.draft}件 ／ 記録なし ${counts.missing}件（本日を含む・未来日を除く）`;message([holidays,attendance,applications].some(source=>source===null)?'本人の日報を表示しました。一部の休日・勤務・休暇情報は取得できません。':'本人の日報を表示しました。');
  }catch(error){if(version===requestNumber){currentCheck=null;$('monthlyDays').replaceChildren();$('monthlyCounts').textContent='件数を確認できません';$('monthlyFollowupCounts').textContent='記入忘れ件数を確認できません';$('onlyActionNeeded').disabled=true;$('monthlyFilterMessage').textContent='';message(error.message,true);$('monthSubmitMessage').textContent=monthly.enabled?'月別提出状態を確認できません。再読み込みしてください。':'月別提出は準備中です。';}}
  finally{if(version===requestNumber)controls(false);}
 }
 $('closingMonth').onchange=load;$('reloadMonth').onclick=load;
 async function monthOptions(){
  const current=period.closingMonth();
  // No existing lower limit is defined. Offer five years, extending to older saved reports.
  let earliest=period.shift(current,-60);
  const rows=await request(`driving_reports?select=employee_id,report_date&employee_id=eq.${employeeId}&order=report_date.asc,id.asc&limit=1`);
  if(!Array.isArray(rows))throw Error('対象月を取得できません。');
  for(const row of rows){
   if(String(row.employee_id)===String(employeeId)&&period.validDate(row.report_date)){
    const savedMonth=period.closingMonth(row.report_date);if(savedMonth<earliest)earliest=savedMonth;
   }
  }
  $('closingMonth').replaceChildren();
  for(let month=current;month>=earliest;month=period.shift(month,-1)){
   const [year,m]=month.split('-');$('closingMonth').add(new Option(`${year}年${Number(m)}月`,month));
  }
  $('closingMonth').value=current;
 }
 void(async()=>{
  try{
   const id=await request('rpc/current_employee_id',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
   if(id===null||!/^\d+$/.test(String(id)))throw Error('有効な社員情報を確認できません。再ログインしてください。');employeeId=String(id);
   $('monthlyEmployee').textContent='自分の日報（21日～翌20日締め）';await monthOptions();await load();
  }catch(error){message(error.message,true);controls(false);}
 })();
})();
