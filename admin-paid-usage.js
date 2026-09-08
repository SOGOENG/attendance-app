/* Existing balance manager authorization and APIs are supplied by the admin page. */
window.createAdminPaidUsage = function ({ rpc, req, allowed, refreshBalances, employeeName, escapeHtml }) {
  const $ = id => document.getElementById(id);
  let employeeId = null, balance = null, generation = 0, busy = false, retry = null;
  const form = $('adminPaidUsageForm');
  const button = $('adminPaidUsageSubmit');
  function yearFor(date) { const [year,month] = date.split('-').map(Number); return year-(month<4?1:0); }
  const today = new Date();
  $('adminPaidUsageDate').value = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
  function clear() {
    generation++; employeeId=null; balance=null; button.disabled=true;
    $('adminPaidUsageBalance').textContent='社員を選択してください';
    $('adminPaidUsageHistory').replaceChildren();
    $('adminPaidUsageMessage').textContent='';
  }
  async function refresh(id) {
    const token=++generation;
    employeeId=Number(id)||null; balance=null; button.disabled=true;
    if(!employeeId) { clear(); return; }
    const date=$('adminPaidUsageDate').value;
    if(!date) { $('adminPaidUsageBalance').textContent='使用日を選択してください'; return; }
    const year=yearFor(date);
    $('adminPaidUsageBalance').textContent='残数を読み込み中…';
    $('adminPaidUsageHistory').replaceChildren();
    try {
      const [rows,history]=await Promise.all([
        req(`paid_leave_balances?select=id,remaining_days,base_date&employee_id=eq.${employeeId}&fiscal_year=eq.${year}`),
        rpc('admin_paid_leave_usage_history',{p_employee_id:employeeId})
      ]);
      if(token!==generation)return;
      balance=rows[0]||null;
      $('adminPaidUsageBalance').textContent=`${year}年度 有給残日数：${balance ? `${balance.remaining_days}日` : '未登録'}`;
      button.disabled=busy||!balance||!allowed();
      $('adminPaidUsageHistory').innerHTML=history.length?history.map(row=>
        `<article class="application-item history-card"><div class="application-item-head"><h3>${escapeHtml(row.usage_date)}／${Number(row.days)}日</h3><span class="status approved">管理者直接登録${row.active?'':'（無効）'}</span></div><p>対象社員：${escapeHtml(employeeName(row.employee_id))}<br>登録者：${escapeHtml(employeeName(row.created_by_employee_id))}（ID：${row.created_by_employee_id}）<br>備考：${escapeHtml(row.note||'-')}<br>登録日時：${escapeHtml(new Date(row.created_at).toLocaleString('ja-JP'))}</p></article>`
      ).join(''):'<p class="empty">管理者直接登録の使用履歴はありません</p>';
    } catch(error) {
      if(token!==generation)return;
      balance=null; button.disabled=true;
      $('adminPaidUsageBalance').textContent='残数・履歴を取得できませんでした';
      $('adminPaidUsageMessage').textContent=error.message;
    }
  }
  $('adminPaidUsageDate').addEventListener('change',()=>refresh(employeeId));
  form.addEventListener('submit',async event=>{
    event.preventDefault();
    if(busy||!form.reportValidity())return;
    const days=Number($('adminPaidUsageDays').value),date=$('adminPaidUsageDate').value;
    const message=$('adminPaidUsageMessage');
    if(!allowed()||!employeeId||!balance){message.textContent='対象社員と残数管理権限を確認してください';return;}
    if(!Number.isFinite(days)||days<=0||days>Number(balance.remaining_days)){message.textContent='使用日数は0より大きく、残日数以下にしてください';return;}
    const payload={p_employee_id:employeeId,p_usage_date:date,p_days:days,p_note:$('adminPaidUsageNote').value.trim()||null};
    const fingerprint=JSON.stringify(payload);
    if(!retry||retry.fingerprint!==fingerprint)retry={fingerprint,id:crypto.randomUUID()};
    busy=true;button.disabled=true;message.textContent='登録しています…';
    // Freeze employee/date changes until the write completes.
    const controls=[...form.elements,$('balanceEmployee'),$('balanceDepartment')];
    const states=controls.map(control=>control.disabled);
    controls.forEach(control=>control.disabled=true);
    try {
      await rpc('register_admin_paid_leave_usage',{...payload,p_request_id:retry.id});
      retry=null;$('adminPaidUsageNote').value='';
      message.textContent='有給使用を登録しました';
      try {
        await refreshBalances();
        message.textContent=balance?'有給使用を登録しました':'有給使用を登録しました。残数・履歴を更新できませんでした。再登録せず再表示してください。';
      }
      catch(error){message.textContent+=`。残数の更新に失敗しました。再登録せず再表示してください：${error.message}`;}
    }catch(error){message.textContent=`登録できませんでした：${error.message}`;}
    finally{controls.forEach((control,index)=>control.disabled=states[index]);busy=false;button.disabled=!balance||!allowed();}
  });
  return {refresh,clear};
};
