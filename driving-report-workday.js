(() => {
 'use strict';
 const list=value=>Array.isArray(value)?value:value?[value]:[];
 const valid=date=>DrivingReportPeriod.validDate(date);
 function calendar(date,holidays){
  if(holidays===null)return 'カレンダー：休日設定を取得できません';
  const rows=holidays.filter(h=>h.date===date);
  if(rows.length>1)return 'カレンダー：休日設定は要確認';
  if(rows.length){const type=rows[0].day_type;return `カレンダー：${type==='出勤'?'勤務日（出勤）':type==='休日'?'会社休日':type==='祝日'?'祝日（会社設定）':type==='有給奨励日'?'有給奨励日': '区分は要確認'}`;}
  const weekday=new Date(`${date}T00:00:00Z`).getUTCDay();
  return `カレンダー：会社設定なし${weekday===0?'（日曜日）':weekday===6?'（土曜日）':'（平日）'}`;
 }
 function leaveFor(date,applications,attendance){
  let full=[],partial=false;
  for(const app of applications){
   if(app.status!=='approved')continue;
   if(app.application_type==='paid_leave')for(const d of list(app.paid_leave_application_details)){
    if(!valid(d.start_date)||!valid(d.end_date)||date<d.start_date||date>d.end_date)continue;
    if(d.day_part!=='full'||!Number.isInteger(Number(d.days))){partial=true;continue;}
    // Approved full-day leave + the application's synchronized row is authoritative.
    const synchronized=attendance.some(a=>String(a.source_application_id)===String(app.id)&&a.source_type==='application'&&a.site_type==='休み'&&a.leave_type==='有給');
    // Without the synchronized row, only an unambiguous single-day approval is used.
    if(synchronized||(d.start_date===d.end_date&&Number(d.days)===1))full.push('全日有給確定');else partial=true;
   }
   if(app.application_type==='comp_leave')for(const d of list(app.comp_leave_application_details))for(const day of list(d.comp_leave_dates)){
    if(day.leave_date!==date)continue;
    if(Number(day.days)===1)full.push('全日代休確定');else partial=true;
   }
  }
  return {full,partial};
 }
 function assess(date,today,report,attendance,applications){
  if(date>today)return {state:'future',text:'提出対象判定：未来日・未提出対象外'};
  if(date===today)return {state:report?.status==='submitted'?'complete':'today',text:report?.status==='submitted'?'提出対象判定：本日・提出完了':'提出対象判定：本日・入力待ち'};
  if(attendance===null||applications===null)return {state:'unknown',text:'提出対象判定：要確認（勤務・休暇情報を取得できません）'};
  const rows=attendance.filter(a=>a.work_date===date),leave=leaveFor(date,applications,rows);
  const working=rows.some(a=>['会社勤務','一般','雑工事'].includes(a.site_type));
  if(rows.length>1||leave.full.length>1||(leave.full.length&&working))return {state:'unknown',text:'提出対象判定：要確認（勤務・休暇情報が重複または矛盾）'};
  if(leave.partial)return {state:'unknown',text:'提出対象判定：要確認（半日休暇・休暇範囲と勤務実績を確認）'};
  if(leave.full.length&&rows.some(a=>a.site_type!=='休み'))return {state:'unknown',text:'提出対象判定：要確認（休暇と出勤区分を確認）'};
  if(leave.full.length)return {state:'exempt',text:`提出対象判定：提出不要（${leave.full[0]}・勤務記録なし）`};
  const confirmed=rows.length===1&&['submitted','locked'].includes(rows[0].status)&&working;
  if(confirmed)return {state:report?.status==='submitted'?'complete':'unsubmitted',text:report?.status==='submitted'?'提出対象判定：勤務確定・提出完了':'提出対象判定：勤務確定・未提出'};
  return {state:'unknown',text:'提出対象判定：要確認（勤務実績未確定）'};
 }
 // Monthly mode uses the same authoritative result as submission. Do not
 // independently reinterpret draft attendance or direct-usage leave ledgers.
 function fromCheck(day,today,report){
  if(day.date>today)return {state:'future',text:'提出対象判定：未来日・未提出対象外'};
  if(day.date===today)return {state:report?.status==='submitted'?'complete':'today',text:'提出対象判定：本日・入力待ち'};
  if(day.issue)return {state:day.issue==='report_missing'?'unsubmitted':'unknown',text:day.issue==='report_missing'?'提出対象判定：日報が必要':'提出対象判定：要確認'};
  if(day.required===true)return {state:report?.status==='submitted'?'complete':'unsubmitted',text:report?.status==='submitted'?'提出対象判定：提出完了':'提出対象判定：日報が必要'};
  if(day.required!==false||!['company_holiday','approved_full_leave'].includes(day.reason))return {state:'unknown',text:'提出対象判定：要確認'};
  return {state:'exempt',text:day.reason==='company_holiday'?'提出対象判定：会社休日・入力不要':'提出対象判定：確定した終日休暇・入力不要'};
 }
 window.DrivingReportWorkday={calendar,assess,fromCheck};
})();
