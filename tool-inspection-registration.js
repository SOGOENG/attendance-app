/* Inspection-only registration UI. Uses existing catalog REST and admin registration via the atomic wrapper. */
(async () => {
  const host = document.getElementById("inspectionRegistration");
  let catalog = [], busy = false, pending = null;
  try {
    await window.inspectionListReady;
    await ToolInspectionWorkflow.requireAdmin();
    if (!currentCycle) throw new Error("点検サイクルを確認できません。");
    await ToolInspectionWorkflow.refreshLatestCompleted();
    if (!ToolInspectionWorkflow.canAddToCycle(currentCycle)) throw new Error("このサイクルには追加できません。初回点検の追加先は直近の完了済みサイクルだけです。");
    host.innerHTML = `
      <form id="inspectionNewToolForm">
        <fieldset id="inspectionNewToolFields">
          <label class="admin-form-label">所有区分<select name="ownership" class="admin-form-control"><option value="shared">共有（会社）</option><option value="personal">個人（会社社員）</option><option value="contractor">協力業者</option></select></label>
          <label class="admin-form-label" id="inspectionOwnerEmployee" hidden>所有者<select name="employee" class="admin-form-control"></select></label>
          <label class="admin-form-label" id="inspectionOwnerCompany" hidden>協力業者名<input name="company" class="admin-form-control"></label>
          <label class="admin-form-label">大分類<select name="group" class="admin-form-control" required></select></label>
          <label class="admin-form-label">工具名<select name="toolName" class="admin-form-control" required></select></label>
          <button id="inspectionMasterOpen" type="button" class="admin-secondary-button">マスタにない工具名を登録</button>
          <fieldset id="inspectionMasterFields" hidden>
            <legend>新しい工具名マスタ</legend>
            <label class="admin-form-label">工具名<input name="newName" class="admin-form-control"></label>
            <label class="admin-form-label">code_prefix<input name="prefix" class="admin-form-control" placeholder="AC"></label>
            <label><input name="masterRequired" type="checkbox" checked> 点検対象の初期値</label>
            <label class="admin-form-label">点検区分の初期値<select name="masterCategory" class="admin-form-control"></select></label>
            <label><input name="masterActive" type="checkbox" checked> 有効</label>
            <label class="admin-form-label">並び順<input name="sortOrder" type="number" step="1" value="0" class="admin-form-control"></label>
            <button id="inspectionMasterSave" type="button" class="admin-secondary-button">工具名マスタを登録</button>
          </fieldset>
          <label class="admin-form-label" id="inspectionLatheLabel" hidden>旋盤サイズ<select name="latheSize" class="admin-form-control"><option value="">選択してください</option><option>1IN</option><option>2IN</option><option>3IN</option><option>4IN</option></select></label>
          <label><input name="inspectionRequired" type="checkbox" checked> この工具を点検対象として登録</label>
          <label class="admin-form-label">点検区分<select name="category" class="admin-form-control" required></select></label>
          <p>管理番号：登録時に自動採番します。旋盤は従来のサイズ別採番です。</p>
          <label class="admin-form-label">備考<textarea name="note" class="admin-form-control"></textarea></label>
          <label id="inspectionInitialPurchaseLabel" hidden><input name="initialPurchase" type="checkbox"> 新規購入した工具の初回点検です（完了済みサイクルへの追加時は必須）</label>
        </fieldset>
        <button id="inspectionNewToolSave" type="submit" class="admin-primary-button">工具を登録して点検へ進む</button>
      </form>
      <p id="inspectionRegistrationMessage" class="schedule-message" role="status"></p>
      <div id="inspectionRegistrationLinks"></div>`;
    const form = document.getElementById("inspectionNewToolForm"), f = form.elements;
    const fields = document.getElementById("inspectionNewToolFields");
    const save = document.getElementById("inspectionNewToolSave");
    const message = document.getElementById("inspectionRegistrationMessage");
    const masterFields = document.getElementById("inspectionMasterFields");
    const retryKey = `inspection-registration:${currentCycle.id}`;
    const options = (select, rows, value, label) => {
      select.replaceChildren(new Option("選択してください", ""));
      rows.forEach(row => select.add(new Option(label(row), value(row))));
    };
    const categories = [["3p","3P工具"],["double_insulated","二重絶縁工具"],["battery","充電式工具"],
      ["cord_reel","コードリール"],["ac_welder","交流式溶接機"],["dc_welder","直流式溶接機"]];
    [f.category,f.masterCategory].forEach(select => options(select,categories,x=>x[0],x=>x[1]));
    const names = () => options(f.toolName,catalog.filter(x=>x.active && x.tool_group===f.group.value),x=>x.tool_name,x=>x.tool_name);
    async function loadCatalog() {
      catalog = await ToolRegistration.loadMasterCatalog();
      if (catalog === null) throw new Error("工具名マスタを導入してから新規登録してください。");
      const group = f.group.value;
      options(f.group,[...new Set([...window.TOOL_GROUPS,...catalog.map(x=>x.tool_group)])],x=>x,x=>x);
      f.group.value = group;
      names();
    }
    function selectName() {
      const item = catalog.find(x=>x.active && x.tool_group===f.group.value && x.tool_name===f.toolName.value);
      f.inspectionRequired.checked = item?.inspection_required ?? true;
      f.category.value = item?.inspection_category || "";
      document.getElementById("inspectionLatheLabel").hidden = f.toolName.value !== "旋盤";
      f.latheSize.required = f.toolName.value === "旋盤";
      if (!f.latheSize.required) f.latheSize.value = "";
    }
    f.group.addEventListener("change", () => { names(); selectName(); });
    f.toolName.addEventListener("change", selectName);
    function updateOwnershipVisibility() {
      document.getElementById("inspectionOwnerEmployee").hidden = f.ownership.value !== "personal";
      document.getElementById("inspectionOwnerCompany").hidden = f.ownership.value !== "contractor";
      f.employee.required = f.ownership.value === "personal";
      f.company.required = f.ownership.value === "contractor";
    }
    f.ownership.addEventListener("change", updateOwnershipVisibility);
    updateOwnershipVisibility();
    const initialPurchaseVisible = currentCycle.status === "completed" && ToolInspectionWorkflow.canAddToCycle(currentCycle);
    document.getElementById("inspectionInitialPurchaseLabel").hidden = !initialPurchaseVisible;
    f.initialPurchase.required = initialPurchaseVisible;
    if (!initialPurchaseVisible) f.initialPurchase.checked = false;
    document.getElementById("inspectionMasterOpen").addEventListener("click", () => { masterFields.hidden = !masterFields.hidden; });
    document.getElementById("inspectionMasterSave").addEventListener("click", async () => {
      if (busy) return;
      const name = f.newName.value.trim(), prefix = f.prefix.value.trim(), order = Number(f.sortOrder.value);
      if (!f.group.value || !name || !/^[A-Za-z0-9]+(-[A-Za-z0-9]+)*$/.test(prefix) || !Number.isInteger(order) || order < -2147483648 || order > 2147483647) {
        message.textContent = "大分類・工具名・半角英数字の接頭辞・並び順を確認してください。"; return;
      }
      if (catalog.some(x=>x.tool_group===f.group.value && x.tool_name===name)) {
        message.textContent = "この工具名は登録済みです。既存マスタを選択してください。無効の場合は工具名マスタ管理で確認してください。"; return;
      }
      if (!window.confirm("この工具名は工具名マスタに登録されていません。新しい工具名として登録しますか？")) return;
      busy = true; fields.disabled = save.disabled = true;
      try {
        await ToolRegistration.request("tool_catalog", {method:"POST",headers:{"Content-Type":"application/json"},
          body:JSON.stringify({tool_group:f.group.value,tool_name:name,code_prefix:prefix,
            inspection_required:f.masterRequired.checked,inspection_category:f.masterCategory.value || null,
            active:f.masterActive.checked,sort_order:order})});
        await loadCatalog(); f.toolName.value=name; selectName(); masterFields.hidden=true;
        message.textContent = "工具名マスタを登録しました。有効な工具名を選び、実工具を登録してください。";
      } catch (error) {
        message.textContent = `マスタ登録を確認できませんでした：${error.message}。再試行前に最新の候補を確認してください。`;
        await loadCatalog().catch(()=>{});
      } finally { busy=false; fields.disabled=save.disabled=false; }
    });
    form.addEventListener("submit", async event => {
      event.preventDefault();
      if (busy || (!pending && !form.reportValidity())) return;
      if (!pending) {
        if (!f.inspectionRequired.checked) { message.textContent="今回点検する工具は点検対象に設定してください。"; return; }
        if (currentCycle.status === "completed" && !f.initialPurchase.checked) { message.textContent="完了済みサイクルへの追加は新規購入工具の初回点検に限ります。"; return; }
        pending = {requestId:crypto.randomUUID(),initialPurchase:f.initialPurchase.checked,latheSize:f.latheSize.value || null,
          record:{tool_group:f.group.value,tool_name:f.toolName.value,ownership_type:f.ownership.value,
            specification:f.toolName.value === "旋盤" ? f.latheSize.value : null,
            assigned_employee_id:f.ownership.value === "personal" ? Number(f.employee.value) : null,
            owner_company_name:f.ownership.value === "contractor" ? f.company.value.trim() : null,
            inspection_required:true,inspection_category:f.category.value,checkout_managed:true,note:f.note.value.trim() || null}};
        sessionStorage.setItem(retryKey,JSON.stringify(pending));
      }
      busy=true; fields.disabled=save.disabled=true;
      try {
        await ToolInspectionWorkflow.refreshLatestCompleted();
        if (!ToolInspectionWorkflow.canAddToCycle(currentCycle)) throw new Error("追加先が直近の完了済みサイクルではなくなりました");
        const tool = await ToolInspectionWorkflow.register(currentCycle.id,pending.record,pending.latheSize,pending.requestId,pending.initialPurchase);
        pending=null; sessionStorage.removeItem(retryKey); form.hidden=true;
        message.textContent=`登録しました：${tool.tool_name}（${tool.management_code}）。このサイクルの点検入力へ進めます。`;
        const links=document.getElementById("inspectionRegistrationLinks");
        const entry=document.createElement("a"); entry.className="admin-primary-button";
        entry.href=`tool-inspection-entry.html?cycle=${encodeURIComponent(currentCycle.id)}&tool=${encodeURIComponent(tool.id)}`;
        entry.textContent="点検入力へ進む"; links.appendChild(entry);
        const qr=document.createElement("a"); qr.className="admin-secondary-button"; qr.href="tool-qr.html"; qr.target="_blank"; qr.rel="noopener";
        qr.textContent=`QRを発行する（${tool.management_code}で検索）`; links.appendChild(qr);
        await refreshInspectionData().catch(error=>{ message.textContent += ` 一覧更新に失敗しました：${error.message}`; });
      } catch(error) {
        // A SQL error means the transaction rolled back. A lost network response is ambiguous:
        // retain the identical request for idempotent retry, even after reload.
        if (error.code) { pending=null; sessionStorage.removeItem(retryKey); }
        message.textContent=`${error.message}。${pending ? "前回と同じ内容で再試行し、登録結果を確認してください。" : "入力を確認してください。"}`;
      } finally { busy=false; fields.disabled=Boolean(pending); save.disabled=false; }
    });
    await loadCatalog();
    selectName();
    const owners=await ToolInspectionWorkflow.rows("employees?select=id,name&active=eq.true&order=name.asc,id.asc");
    options(f.employee,owners,x=>x.id,x=>x.name);
    pending=JSON.parse(sessionStorage.getItem(retryKey) || "null");
    if (pending) { fields.disabled=true; message.textContent="前回の登録結果が未確認です。ボタンを押して同じ要求の結果を確認してください。"; }
  } catch(error) { host.textContent=error.message; }
})();
