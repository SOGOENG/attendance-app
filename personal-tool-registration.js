/* 本人工具登録のUI。点検区分の選択値はDBでも検証する。 */
window.initializePersonalToolRegistration = function (refreshList, employeeId) {
  const section = document.getElementById("personalToolRegistration");
  const form = document.getElementById("personalToolRegistrationForm");
  const open = document.getElementById("personalToolRegisterOpen");
  const cancel = document.getElementById("personalToolRegisterCancel");
  const message = document.getElementById("personalToolRegistrationMessage");
  const correctIdentity = document.getElementById("personalToolCorrectIdentity");
  const identityHint = document.getElementById("personalToolIdentityHint");
  const group = form.elements.group;
  const name = form.elements.toolName;
  const size = form.elements.latheSize;
  const category = form.elements.inspectionCategory;
  const required = form.elements.inspectionRequired;
  const allowedCategories = ["3p", "double_insulated", "battery", "cord_reel", "ac_welder", "dc_welder"];
  const save = form.querySelector('[type="submit"]');
  let catalog = [];
  let busy = false;
  let loading = false;
  let editingTool = null;
  let correctingIdentity = false;
  const correctionGuide = "工具名を訂正すると、管理番号もその工具用に自動変更されます。";
  const correctionBlocked = "この工具はすでに点検や使用の記録があるため、工具名を訂正できません。管理者に連絡してください。";

  function selectCorrectionTool() {
    const candidates = catalog.filter(item => item.tool_name === name.value);
    // The user selects only a name. Never guess a group for an ambiguous master entry.
    const selected = name.value === editingTool.tool_name
      ? candidates.find(item => item.tool_group === editingTool.tool_group)
      : candidates.length === 1 ? candidates[0] : null;
    group.value = selected?.tool_group || "";
    if (name.value && !selected) {
      identityHint.textContent = "この工具名の登録情報を特定できません。管理者に連絡してください。";
    } else {
      identityHint.textContent = correctionGuide;
    }
  }

  function options(select, values) {
    select.replaceChildren(new Option("選択してください", ""));
    values.forEach(value => select.add(new Option(value, value)));
  }
  function updateName() {
    const item = catalog.find(item => item.tool_group === group.value && item.tool_name === name.value);
    const identityChanged = editingTool && (group.value !== editingTool.tool_group || name.value !== editingTool.tool_name);
    const isLathe = (!editingTool || (correctingIdentity && identityChanged)) && name.value === "旋盤";
    size.closest("label").classList.toggle("hidden", !isLathe);
    size.required = isLathe;
    if (!isLathe) size.value = "";
    const usesDefaults = !editingTool && typeof item?.inspection_required === "boolean";
    required.closest("label").classList.toggle("hidden", !usesDefaults);
    required.disabled = !usesDefaults || busy;
    const needsCategory = usesDefaults ? required.value === "true" :
      Boolean(group.value) && group.value !== "充電工具" && (correctingIdentity ? true : editingTool ? editingTool.inspection_required !== false : true);
    const showCategory = usesDefaults || needsCategory;
    category.closest("label").classList.toggle("hidden", !showCategory);
    category.required = needsCategory;
    category.disabled = !showCategory;
    if (!showCategory && !editingTool) category.value = "";
    document.getElementById("personalToolInspectionHint").textContent = !item ? "" :
      needsCategory ? "点検対象として登録されます。工具本体を確認して点検区分を選択してください。" : "点検対象外として登録されます";
    save.disabled = busy || !item || (needsCategory && !allowedCategories.includes(category.value) && !(editingTool && !correctingIdentity && category.value === editingTool.inspection_category)) ||
      (correctingIdentity && !identityChanged);
    if (editingTool) {
      group.disabled = true;
      name.disabled = !correctingIdentity;
      save.textContent = correctingIdentity ? "工具名の訂正を保存" : "修正を保存";
    }
  }
  group.addEventListener("change", () => {
    category.value = "";
    options(name, catalog.filter(item => item.tool_group === group.value).map(item => item.tool_name));
    name.disabled = !group.value;
    updateName();
  });
  name.addEventListener("change", () => {
    if (editingTool && correctingIdentity) {
      category.value = "";
      selectCorrectionTool();
    }
    if (!editingTool) {
      const master = catalog.find(item => item.tool_group === group.value && item.tool_name === name.value);
      required.value = String(master?.inspection_required ?? group.value !== "充電工具");
      category.value = master?.inspection_category || "";
    }
    updateName();
  });
  category.addEventListener("change", updateName);
  required.addEventListener("change", updateName);
  section.classList.remove("hidden");
  async function openForm(tool = null) {
    if (busy || loading) return;
    if (tool && (tool.ownership_type !== "personal" || !employeeId ||
        String(tool.assigned_employee_id) !== String(employeeId))) return;
    loading = true;
    open.disabled = true;
    message.textContent = "工具マスタを読み込んでいます…";
    try {
      catalog = await ToolRegistration.loadCatalog();
      if ((tool?.inspection_category === "battery" || catalog.some(item => item.inspection_category === "battery")) && !Array.from(category.options).some(option => option.value === "battery")) category.add(new Option("充電式工具", "battery"));
      if (tool && !catalog.some(item => item.tool_group === tool.tool_group && item.tool_name === tool.tool_name)) catalog.push({...tool, active: false});
      if (tool?.inspection_category && !Array.from(category.options).some(option => option.value === tool.inspection_category)) category.add(new Option(`${tool.inspection_category}（現在値）`, tool.inspection_category));
      editingTool = tool;
      correctingIdentity = false;
      form.reset();
      options(group, [...new Set(catalog.map(item => item.tool_group))]);
      options(name, []);
      name.disabled = true;
      group.disabled = Boolean(tool);
      group.closest("label").classList.toggle("hidden", Boolean(tool));
      correctIdentity.classList.toggle("hidden", !tool);
      correctIdentity.textContent = "工具名を訂正する";
      identityHint.textContent = tool ? correctionGuide : "";
      document.getElementById("personalToolFormTitle").textContent = tool ? "個人工具を修正" : "個人工具の新規登録";
      document.getElementById("personalToolFormGuide").textContent = tool
        ? `管理番号：${tool.management_code || "-"}`
        : "ログイン中の本人の個人工具として登録します。管理番号は自動採番されます。";
      save.textContent = tool ? "修正を保存" : "登録する";
      if (tool) {
        group.value = tool.tool_group || "";
        options(name, catalog.filter(item => item.tool_group === group.value).map(item => item.tool_name));
        name.disabled = !group.value;
        name.value = tool.tool_name || "";
        category.value = tool.inspection_category || "";
        for (const [field, column] of Object.entries({specification:"specification", manufacturer:"manufacturer",
          modelNumber:"model_number", serialNumber:"serial_number", performance:"performance", note:"note"})) {
          form.elements[field].value = tool[column] || "";
        }
      }
      updateName();
      form.classList.remove("hidden");
      open.setAttribute("aria-expanded", "true");
      message.textContent = catalog.length ? "" : "登録できる工具マスタがありません。管理者に確認してください。";
      if (tool) form.elements.specification.focus();
      else group.focus();
    } catch (error) {
      message.textContent = error.message;
    } finally {
      open.disabled = false;
      loading = false;
    }
  }
  open.addEventListener("click", () => openForm());
  correctIdentity.addEventListener("click", () => {
    if (busy || loading || !editingTool) return;
    correctingIdentity = !correctingIdentity;
    correctIdentity.textContent = correctingIdentity ? "工具名の訂正をやめる" : "工具名を訂正する";
    identityHint.textContent = correctionGuide;
    if (correctingIdentity) {
      options(name, [...new Set(catalog.filter(item => item.active !== false).map(item => item.tool_name))]);
      name.value = editingTool.tool_name;
      selectCorrectionTool();
    } else {
      group.value = editingTool.tool_group;
      options(name, catalog.filter(item => item.tool_group === group.value).map(item => item.tool_name));
      name.value = editingTool.tool_name;
      category.value = editingTool.inspection_category || "";
    }
    updateName();
    if (correctingIdentity) name.focus();
  });
  cancel.addEventListener("click", () => {
    if (busy || loading) return;
    form.classList.add("hidden");
    open.setAttribute("aria-expanded", "false");
    open.focus();
  });
  form.addEventListener("submit", async event => {
    event.preventDefault();
    if (busy || loading || !form.reportValidity()) return;
    if (!catalog.some(item => item.tool_group === group.value && item.tool_name === name.value)) {
      message.textContent = "工具マスタから工具を選択してください";
      return;
    }
    if (editingTool) {
      const changed = group.value !== editingTool.tool_group || name.value !== editingTool.tool_name;
      if (changed !== correctingIdentity) {
        message.textContent = changed ? "工具名は「工具名を訂正する」から変更してください" : "新しい工具名を選択してください";
        return;
      }
    }
    if (category.required && !allowedCategories.includes(category.value) && !(editingTool && !correctingIdentity && category.value === editingTool.inspection_category)) {
      message.textContent = "点検区分を選択してください";
      return;
    }
    busy = true;
    save.disabled = cancel.disabled = open.disabled = correctIdentity.disabled = true;
    const isEditing = Boolean(editingTool);
    message.textContent = isEditing ? "修正を保存しています…" : "登録しています…";
    try {
      const values = {
        p_group: group.value, p_name: name.value,
        p_specification: form.elements.specification.value.trim(),
        p_note: form.elements.note.value.trim(), p_lathe_size: size.value || null,
        p_inspection_category: (!isEditing && !required.disabled) || (isEditing && !correctingIdentity) ? category.value || null : group.value === "充電工具" ? null : category.value || null,
        p_manufacturer: form.elements.manufacturer.value.trim() || null,
        p_model_number: form.elements.modelNumber.value.trim() || null,
        p_serial_number: form.elements.serialNumber.value.trim() || null,
        p_performance: form.elements.performance.value.trim() || null
      };
      let tool;
      if (isEditing && correctingIdentity) {
        tool = await ToolRegistration.correctPersonalIdentity({p_tool_id: editingTool.id, ...values});
      } else if (isEditing) {
        delete values.p_lathe_size;
        tool = await ToolRegistration.updatePersonal({p_tool_id: editingTool.id, ...values});
      } else {
        const master = catalog.find(item => item.tool_group === group.value && item.tool_name === name.value);
        if (typeof master?.inspection_required === "boolean") values.p_inspection_required = required.value === "true";
        tool = await ToolRegistration.registerPersonal(values);
      }
      editingTool = null;
      correctingIdentity = false;
      identityHint.textContent = "";
      form.reset();
      form.classList.add("hidden");
      open.setAttribute("aria-expanded", "false");
      message.textContent = `${isEditing ? "修正を保存しました" : "工具を登録しました"}（管理番号：${tool.management_code}）`;
      try {
        await refreshList(tool.assigned_employee_id);
      } catch (error) {
        message.textContent += `。一覧の更新に失敗しました：${error.message}。再登録せず、ページを再読み込みしてください。`;
      }
    } catch (error) {
      // Also normalize the older RPC message while the DB migration is being applied.
      const isRecordBlocked = correctingIdentity && (error.message === correctionBlocked ||
        /履歴がある|点検や使用の記録がある/.test(error.message));
      const detail = String(error.message || "保存できませんでした").replaceAll("履歴", "運用記録");
      message.textContent = isRecordBlocked ? correctionBlocked :
        `${isEditing ? "修正を保存できませんでした" : "登録できませんでした"}：${detail}`;
    } finally {
      busy = false;
      cancel.disabled = open.disabled = correctIdentity.disabled = false;
      updateName();
    }
  });
  return { edit: tool => openForm(tool) };
};
