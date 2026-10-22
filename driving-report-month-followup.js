(() => {
 'use strict';
 // Presentation of RPC results only. Work/holiday/leave eligibility stays in SQL.
 const labels={report_missing:'日報がありません',work_unconfirmed:'勤務実績を確認してください',calendar_unconfirmed:'休日設定を確認してください',half_or_ambiguous_leave:'半日休暇・勤務実績を確認してください',work_leave_conflict:'勤務と休暇の情報が一致しません',holiday_work_attendance_conflict:'休日出勤と出勤簿を確認してください',receipt_upload_pending:'領収書の処理が完了していません',driving_submission_fields_required:'経路・車両・メーターが未完了です',all_13_official_inspections_required:'点検13項目が未完了です',both_pre_drive_alcohol_checks_required:'アルコールチェックが未完了です',end_odometer_before_start:'帰着メーターが出発メーターより小さくなっています',accident_violation_note_required:'事故・違反の詳細を入力してください',before_and_after_alcohol_checks_required:'朝・帰着後のアルコールチェックが未完了です',no_driving_must_not_have_driving_data:'運転なしの日報に運転・給油記録が残っています',invalid_driving_status:'運転あり・運転なしを確認してください',own_report_required:'本人の日報か確認し、再読み込みしてください'};
 const incomplete=new Set(['receipt_upload_pending','driving_submission_fields_required','all_13_official_inspections_required','both_pre_drive_alcohol_checks_required','end_odometer_before_start','accident_violation_note_required','before_and_after_alcohol_checks_required','no_driving_must_not_have_driving_data','invalid_driving_status']);
 function classify(date,today,day,errors,row,monthSubmitted=false){
  const result=(kind,reason)=>({kind,reason,action:['missing','incomplete','review'].includes(kind)});
  if(date>today)return result('future','未来日・記入忘れ集計の対象外');
  if(monthSubmitted)return result('complete','月別提出済み');
  if(date===today)return day?.status==='submitted'||row?.status==='submitted'?result('complete','提出済み'):result('today','入力待ち（本日・記入忘れ集計の対象外）');
  if(!day)return row?.status==='submitted'?result('complete','提出済み'):result('unavailable','月別確認の判定を取得できないため、記入忘れは未判定です');
  const codes=[...new Set([day.issue,...errors.filter(e=>e.date===date).map(e=>e.code)].filter(Boolean))];
  if(codes.length){
   const reason=codes.map(code=>labels[code]||'日報・勤務等の情報を確認してください').join('／');
   if(codes.length===1&&codes[0]==='report_missing'&&!row&&day.report_id==null)return result('missing',reason);
   return result(codes.every(code=>incomplete.has(code))?'incomplete':'review',reason);
  }
  // A submitted daily report may still have a work/calendar conflict in the
  // month RPC. Do not suppress that issue merely because the report is saved.
  if(day.status==='submitted'||row?.status==='submitted')return result('complete','提出済み');
  if(day.required===false&&['company_holiday','approved_full_leave'].includes(day.reason))return result('exempt',day.reason==='company_holiday'?'会社休日・入力不要':'確定した終日休暇・入力不要');
  if(day.required===true){
   if(row||day.report_id!=null)return result('ready','保存済み・入力完了（月別提出待ち）');
   return result('missing','日報が必要です（未入力）');
  }
  return result('review','提出対象の判定を確認してください');
 }
 window.DrivingReportMonthFollowup={classify,labels};
})();
