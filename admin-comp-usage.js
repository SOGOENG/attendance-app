window.createAdminCompUsage = function ({rpc,allowed,refreshWork,employeeName,escapeHtml}) {
  const panel=document.getElementById('adminCompUsage');
  const $=id=>panel.querySelector(`#${id}`)||document.getElementById(id);
  const form=$('adminCompUsageForm'),button=$('adminCompUsageSubmit');
  let employeeId=null,remaining=0,busy=false,generation=0,retry=null;
  const now=new Date();
  $('adminCompUsageDate').value=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
  function clear(){generation++;employeeId=null;remaining=0;panel.hidden=true;button.disabled=true;$('adminCompUsageHistory').replaceChildren();}
  async function refresh(id,records){
    const token=++generation;employeeId=Number(id)||null;
    if(!employeeId){clear();return;}
    remaining=records.filter(row=>row.status==='active').reduce((sum,row)=>sum+Number(row.remaining_days),0);
    const summary=document.querySelector('#workList .work-history-summary');
    if(!summary){clear();return;}
    summary.insertAdjacentElement('afterend',panel);panel.hidden=false;
    button.disabled=busy||!allowed()||remaining<=0;
    $('adminCompUsageHistory').replaceChildren();
    try{
      const history=await rpc('admin_comp_leave_usage_history',{p_employee_id:employeeId});
      if(token!==generation)return;
      $('adminCompUsageHistory').innerHTML=history.length?history.map(row=>
        `<article class="application-item history-card"><div class="application-item-head"><h3>${escapeHtml(row.usage_date)}／${Number(row.days)}日</h3><span class="status approved">管理者直接登録${row.status==='approved'?'':'（取消）'}</span></div><p>対象社員：${escapeHtml(employeeName(row.employee_id))}<br>登録者：${escapeHtml(employeeName(row.created_by_employee_id))}（ID：${row.created_by_employee_id}）<br>備考：${escapeHtml(row.note||'-')}<br>登録日時：${escapeHtml(new Date(row.created_at).toLocaleString('ja-JP'))}</p></article>`
      ).join(''):'<p class="empty">管理者直接登録の代休使用履歴はありません</p>';
    }catch(error){if(token===generation)$('adminCompUsageHistory').textContent=`履歴を取得できませんでした：${error.message}`;}
  }
  form.addEventListener('submit',async event=>{
    event.preventDefault();if(busy||!form.reportValidity())return;
    const message=$('adminCompUsageMessage'),days=Number($('adminCompUsageDays').value);
    if(!allowed()||!employeeId){message.textContent='対象社員と残数管理権限を確認してください';return;}
    if(!Number.isFinite(days)||days<=0||days>remaining){message.textContent='使用日数は0より大きく、代休残日数以下にしてください';return;}
    const payload={p_employee_id:employeeId,p_usage_date:$('adminCompUsageDate').value,p_days:days,p_note:$('adminCompUsageNote').value.trim()||null};
    const fingerprint=JSON.stringify(payload);
    if(!retry||retry.fingerprint!==fingerprint)retry={fingerprint,id:crypto.randomUUID()};
    busy=true;
    const controls=[...form.elements,$('workEmployee'),$('workDepartment')],states=controls.map(c=>c.disabled);
    controls.forEach(c=>c.disabled=true);message.textContent='登録しています…';
    try{
      await rpc('register_admin_comp_leave_usage',{...payload,p_request_id:retry.id});
      retry=null;$('adminCompUsageNote').value='';message.textContent='代休使用を登録しました';
      try{await refreshWork();}catch(error){
        remaining=0;
        document.getElementById('workList').appendChild(panel);panel.hidden=false;
        message.textContent+=`。一覧更新に失敗しました。再登録せず再表示してください：${error.message}`;
      }
    }catch(error){message.textContent=`登録できませんでした：${error.message}`;}
    finally{controls.forEach((c,i)=>c.disabled=states[i]);busy=false;button.disabled=!employeeId||!allowed()||remaining<=0;}
  });
  return {clear,refresh};
};
