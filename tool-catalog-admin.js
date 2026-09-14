/* Independent master editor. No tools rows are updated or deleted here. */
(async function () {
  const section = document.getElementById("toolCatalogAdmin");
  const group = document.getElementById("catalogGroup");
  const list = document.getElementById("catalogList");
  const form = document.getElementById("catalogForm");
  const message = document.getElementById("catalogMessage");
  const add = document.getElementById("catalogAdd");
  const save = form.querySelector('[type="submit"]');
  let rows = [], editingId = null, busy = false;
  const fields = form.elements;
  function render() {
    list.replaceChildren();
    rows.filter(row => row.tool_group === group.value).forEach(row => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "admin-secondary-button";
      button.textContent = `${row.tool_name} / ${row.code_prefix} / ${row.active ? "有効" : "無効"} / 順序 ${row.sort_order}`;
      button.disabled = busy;
      button.addEventListener("click", () => edit(row));
      list.appendChild(button);
    });
  }
  function edit(row = null) {
    if (busy || !group.value) return;
    editingId = row?.id ?? null;
    form.reset();
    fields.toolName.value = row?.tool_name || "";
    fields.codePrefix.value = row?.code_prefix || "";
    fields.inspectionRequired.checked = row?.inspection_required ?? group.value !== "充電工具";
    fields.inspectionCategory.value = row?.inspection_category || "";
    fields.sortOrder.value = row?.sort_order ?? 0;
    fields.active.checked = row?.active ?? true;
    form.hidden = false;
    fields.toolName.focus();
  }
  async function reload() {
    rows = await ToolRegistration.loadMasterCatalog();
    if (rows === null) throw new Error("工具名マスタは未導入です。add_tool_catalog.sql を適用してください。");
    const selected = group.value;
    group.replaceChildren(new Option("大分類を選択", ""));
    [...new Set([...window.TOOL_GROUPS, ...rows.map(row => row.tool_group)])].forEach(value => group.add(new Option(value, value)));
    group.value = selected;
    render();
  }
  group.addEventListener("change", () => { form.hidden = true; render(); });
  add.addEventListener("click", () => {
    if (!group.value) { message.textContent = "大分類を選択してください。"; return; }
    edit();
  });
  document.getElementById("catalogCancel").addEventListener("click", () => { if (!busy) form.hidden = true; });
  form.addEventListener("submit", async event => {
    event.preventDefault();
    if (busy || !form.reportValidity()) return;
    const record = {
      tool_group: group.value, tool_name: fields.toolName.value.trim(),
      code_prefix: fields.codePrefix.value.trim(),
      inspection_required: fields.inspectionRequired.checked,
      inspection_category: fields.inspectionCategory.value || null,
      sort_order: Number(fields.sortOrder.value), active: fields.active.checked
    };
    busy = true;
    save.disabled = add.disabled = group.disabled = true;
    render();
    message.textContent = "保存しています…";
    let saved = false;
    try {
      const result = await ToolRegistration.request(editingId === null ? "tool_catalog" : `tool_catalog?id=eq.${encodeURIComponent(editingId)}`, {
        method: editingId === null ? "POST" : "PATCH",
        headers: {"Content-Type": "application/json", Prefer: "return=representation"},
        body: JSON.stringify(record)
      });
      if (!Array.isArray(result) || result.length !== 1) throw new Error("保存対象を確認できません。権限と最新のマスタを確認してください。");
      saved = true;
      form.hidden = true;
      await reload();
      await loadTools();
      message.textContent = "保存しました。既存工具の名前・管理番号・点検設定は変更していません。";
    } catch (error) {
      message.textContent = saved ? `保存済みですが候補の更新に失敗しました。再登録せずページを再読み込みしてください：${error.message}` : error.message;
    } finally {
      busy = false;
      save.disabled = add.disabled = group.disabled = false;
      render();
    }
  });
  try {
    const admin = await ToolRegistration.request("rpc/is_tool_registration_admin", {
      method: "POST", headers: {"Content-Type": "application/json"}, body: "{}"
    });
    if (admin !== true) return;
    section.hidden = false;
    await reload();
  } catch (error) {
    message.textContent = error.message;
    add.disabled = true;
  }
})();
