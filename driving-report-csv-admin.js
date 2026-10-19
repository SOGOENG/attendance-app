(() => {
  'use strict';
  const $=id=>document.getElementById(id),csv=DrivingReportCsv,period=DrivingReportPeriod;
  let busy=false,authorized=false,result=null,loadedMonth=null;
  const selected=new Set();
  function message(text,error=false){$('csvMessage').textContent=text;$('csvMessage').classList.toggle('is-error',error);}
  function controls(){
    for(const key of ['closingMonth','reloadCsv'])$(key).disabled=busy||!authorized;
    for(const key of ['selectAll','clearSelection','confirmRoster'])$(key).disabled=busy;
    for(const box of $('csvRoster').querySelectorAll('input'))box.disabled=busy||box.dataset.submitted==='true';
    $('downloadCsvZip').disabled=busy||!result||!result.submittedEmployeeIds.length||loadedMonth!==$('closingMonth').value||!$('confirmRoster').checked;
  }
  function missing(){return result?result.employees.filter(e=>selected.has(String(e.id))&&!result.submittedEmployeeIds.includes(String(e.id))):[];}
  function summary(){
    if(!result)return;
    const absent=missing();
    $('csvSummary').textContent=`選択名簿の対象 ${selected.size}人 ／ 月別提出済み ${result.submittedEmployeeIds.length}人 ／ 未提出 ${absent.length}人。${absent.length?'提出済み分のみ出力します。':'選択対象者は全員提出済みです。'}会社全体の対象人数は名簿確認が必要です。`;
    $('csvMissing').textContent=absent.length?'未提出：'+absent.map(e=>`${e.name}（ID ${e.id}）`).join('、'):'';
    $('downloadCsvZip').textContent=absent.length?`提出済み${result.submittedEmployeeIds.length}人分のみZIPで出力`:'正式CSV 3種類をZIPで出力';
    controls();
  }
  async function source(month){
    period.range(month);
    const response=await portalFetch(`${PORTAL_SUPABASE_URL}/rest/v1/rpc/admin_driving_report_csv_source`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({p_closing_month:month+'-01'})});
    const text=await response.text();
    if(!response.ok){
      let error;try{error=JSON.parse(text);}catch{error={};}
      if(error.code==='42501'&&error.message!=='admin_required'){throw Error('DBの読取権限・RLSの完全性を確認できないため、出力を停止しました。管理者に確認してください。');}
      if(response.status===401||response.status===403||error.code==='42501'){authorized=false;throw Error('全体管理者のみCSVを出力できます。ログイン状態と権限を確認してください。');}
      if(error.code==='PGRST202'||response.status===404)throw Error('CSV出力用の読取RPCが未適用です。管理者に準備状況を確認してください。');
      if(error.message==='driving_month_not_closed')throw Error('締め日の翌21日以降の月を選択してください。');
      if(error.message==='csv_export_too_large')throw Error('出力対象の履歴が大きすぎます。管理者に確認してください。');
      throw Error('CSVデータを取得できません。時間をおいて再確認してください。');
    }
    return csv.parseSource(text);
  }
  function render(next){
    result=next;const official=new Set(next.submittedEmployeeIds);
    for(const employeeId of [...selected])if(!next.employees.some(e=>String(e.id)===employeeId))selected.delete(employeeId);
    for(const employeeId of official)selected.add(employeeId);
    $('csvRoster').replaceChildren();
    for(const e of next.employees){
      const employeeId=String(e.id),label=document.createElement('label'),box=document.createElement('input'),text=document.createElement('span');
      box.type='checkbox';box.value=employeeId;box.checked=selected.has(employeeId);box.dataset.submitted=String(official.has(employeeId));
      text.textContent=`${e.department||'所属未設定'} ／ ${e.name}（ID ${employeeId}）${official.has(employeeId)?' 月別提出済み':''}`;
      box.onchange=()=>{if(box.checked)selected.add(employeeId);else selected.delete(employeeId);$('confirmRoster').checked=false;summary();};
      label.append(box,text);$('csvRoster').append(label);
    }
    $('csvWarnings').replaceChildren();
    for(const warning of next.warnings){const item=document.createElement('li');item.textContent=warning;$('csvWarnings').append(item);}
    $('csvContent').hidden=false;summary();
  }
  async function load(){
    if(busy||!authorized)return;busy=true;result=null;$('csvContent').hidden=true;$('confirmRoster').checked=false;controls();
    const month=$('closingMonth').value;
    try{
      const span=period.range(month);$('csvPeriod').textContent=`対象期間：${span.start} 〜 ${span.end}`;message('提出状況とデータを確認中…');
      const data=await source(month),next=csv.build(data,month,crypto.randomUUID());loadedMonth=month;render(next);
      message(`月別提出済み ${next.submittedEmployeeIds.length}人の日報 ${next.daily.length}行・給油 ${next.fuel.length}件を確認しました。対象者を確認してください。`);
    }catch(error){result=null;message(error.message,true);}finally{busy=false;controls();}
  }
  $('downloadCsvZip').onclick=async()=>{
    if(busy||!result||!result.submittedEmployeeIds.length||!$('confirmRoster').checked||loadedMonth!==$('closingMonth').value)return;
    busy=true;controls();const month=loadedMonth,oldSubmitted=result.submittedEmployeeIds.slice().sort().join(',');
    try{
      message('出力時点のデータを確認中…');
      const exportId=crypto.randomUUID(),data=await source(month),next=csv.build(data,month,exportId);
      loadedMonth=month;render(next);
      if(next.submittedEmployeeIds.slice().sort().join(',')!==oldSubmitted){$('confirmRoster').checked=false;message('提出者が変わりました。対象者を確認して、もう一度出力してください。');return;}
      const absent=missing();
      if(absent.length&&!window.confirm(`対象 ${selected.size}人のうち未提出 ${absent.length}人は含まれません。月別提出済み ${next.submittedEmployeeIds.length}人分のみ出力しますか？`)){message('出力を取り消しました。');return;}
      const blob=csv.zip(next.files),url=URL.createObjectURL(blob),link=document.createElement('a');
      link.href=url;link.download=`運転日報_正式_${month}_v1_${exportId}.zip`;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
      message(`3種類のCSVを含むZIPのダウンロードを開始しました（出力ID ${exportId}）。${next.warnings.length?'前回給油に要確認の車両があります。':''}`);
    }catch(error){result=null;$('csvContent').hidden=true;message(error.message,true);}finally{busy=false;controls();}
  };
  $('selectAll').onclick=()=>{if(!result)return;result.employees.forEach(e=>selected.add(String(e.id)));$('confirmRoster').checked=false;render(result);};
  $('clearSelection').onclick=()=>{if(!result)return;selected.clear();$('confirmRoster').checked=false;render(result);};
  $('confirmRoster').onchange=controls;$('closingMonth').onchange=load;$('reloadCsv').onclick=load;
  (async()=>{
    try{
      const response=await portalFetch(`${PORTAL_SUPABASE_URL}/rest/v1/rpc/is_application_admin`,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
      if(!response.ok||await response.json()!==true)throw Error('全体管理者のみ利用できます。ログイン状態と権限を確認してください。');
      authorized=true;
      const today=period.today();$('closingMonth').value=Number(today.slice(-2))>=21?today.slice(0,7):period.shift(today.slice(0,7),-1);
      await load();
    }catch(error){message(error.message,true);}finally{controls();}
  })();
})();
