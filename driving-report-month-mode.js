// Develop: enable the deployed company API on local development pages.
// Other projects remain blocked; loopback test APIs still require explicit opt-in.
(() => {
 'use strict';
 const loopback=host=>['localhost','127.0.0.1','[::1]'].includes(host);
 const development=host=>loopback(host)||/^192\.168\.\d{1,3}\.\d{1,3}$/.test(host);
 const requested=new URLSearchParams(location.search).get('mode')==='monthly';
 function company(){try{return new URL(PORTAL_SUPABASE_URL).href==='https://fgmvmbjnoyagnpygcbky.supabase.co/';}catch{return false;}}
 function safe(){try{const api=new URL(PORTAL_SUPABASE_URL);return development(location.hostname)&&(company()||loopback(api.hostname))&&['http:','https:'].includes(api.protocol)&&!api.username&&!api.password;}catch{return false;}}
 const enabled=safe()&&(company()||requested),firstMonth=company()?'2026-10':null;
 const conflict=error=>['55P03','40P01','40001'].includes(error?.code)||/driving_(month|calendar)_busy_retry|driving_month_already_submitted|own_draft_required|reopen_draft_before_correction/.test(error?.message||'');
 const conflictMessage='ほかの操作と重なりました。再読み込みしてから保存してください';
 async function rpc(name,month){
  if(!enabled||!safe())throw Error('月別提出は準備中です。');
  if(!['check_driving_report_month','submit_driving_report_month'].includes(name))throw Error('操作が不正です。');
  const span=DrivingReportPeriod.range(month);
  if(name==='submit_driving_report_month'&&((firstMonth&&month<firstMonth)||DrivingReportPeriod.today()<span.endExclusive))throw Error('対象期間の締め日の翌21日から提出できます。');
  const response=await portalFetch(`${PORTAL_SUPABASE_URL}/rest/v1/rpc/${name}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({p_closing_month:month+'-01'})});
  const data=await response.json().catch(()=>null);
  if(!response.ok){const error=Error(data?.message||'月別提出の応答を確認できません。再読み込みしてください。');error.code=data?.code;throw error;}
  if(!data||typeof data!=='object'||Array.isArray(data))throw Error('月別提出の応答を確認できません。');
  return data;
 }
 function validCheck(data,month){
  const span=DrivingReportPeriod.range(month);
  if(data.closing_month!==month+'-01'||data.period_start!==span.start||data.period_end!==span.end||
   typeof data.valid!=='boolean'||typeof data.eligible!=='boolean'||typeof data.already_submitted!=='boolean'||!Array.isArray(data.errors)||!Array.isArray(data.days)||data.valid!==(data.errors.length===0)||data.days.length!==span.days.length||data.days.some((day,index)=>day?.date!==span.days[index])||data.errors.some(issue=>!span.days.includes(issue?.date)||typeof issue.code!=='string'))throw Error('月別確認の応答を確認できません。再読み込みしてください。');
  return data;
 }
 const link=date=>`driving-report.html?date=${date}${enabled?'&mode=monthly':''}`;
 window.DrivingReportMonthMode=Object.freeze({enabled,firstMonth,blocked:requested&&!enabled,conflict,conflictMessage,rpc,validCheck,link});
})();
