/* 本人工具登録のUI。点検区分の選択値はDBでも検証する。 */
window.initializePersonalToolRegistration = function (refreshList) {
  const section = document.getElementById("personalToolRegistration");
  const form = document.getElementById("personalToolRegistrationForm");
  const open = document.getElementById("personalToolRegisterOpen");
  const cancel = document.getElementById("personalToolRegisterCancel");
  const message = document.getElementById("personalToolRegistrationMessage");
  const group = form.elements.group;
  const name = form.elements.toolName;
  const size = form.elements.latheSize;
  const category = form.elements.inspectionCategory;
  const allowedCategories = ["3p", "double_insulated", "cord_reel", "ac_welder", "dc_welder"];
  const save = form.querySelector('[type="submit"]');
  let catalog = [];
  let busy = false;

  function options(select, values) {
    select.replaceChildren(new Option("選択してください", ""));
    values.forEach(value => select.add(new Option(value, value)));
  }
  function updateName() {
    const item = catalog.find(item => item.tool_group === group.value && item.tool_name === name.value);
    const isLathe = name.value === "旋盤";
    size.closest("label").classList.toggle("hidden", !isLathe);
    size.required = isLathe;
    if (!isLathe) size.value = "";
    const needsCategory = Boolean(group.value) && group.value !== "充電工具";
    category.closest("label").classList.toggle("hidden", !needsCategory);
    category.required = needsCategory;
    category.disabled = !needsCategory;
    if (!needsCategory) category.value = "";
    document.getElementById("personalToolInspectionHint").textContent = !item ? "" :
      needsCategory ? "点検対象として登録されます。工具本体を確認して点検区分を選択してください。" : "点検対象外として登録されます";
    save.disabled = busy || !item || (needsCategory && !allowedCategories.includes(category.value));
  }
  group.addEventListener("change", () => {
    category.value = "";
    options(name, catalog.filter(item => item.tool_group === group.value).map(item => item.tool_name));
    name.disabled = !group.value;
    updateName();
  });
  name.addEventListener("change", updateName);
  category.addEventListener("change", updateName);
  section.classList.remove("hidden");
  open.addEventListener("click", async () => {
    open.disabled = true;
    message.textContent = "工具マスタを読み込んでいます…";
    try {
      catalog = await ToolRegistration.loadCatalog();
      form.reset();
      options(group, [...new Set(catalog.map(item => item.tool_group))]);
      options(name, []);
      name.disabled = true;
      updateName();
      form.classList.remove("hidden");
      open.setAttribute("aria-expanded", "true");
      message.textContent = catalog.length ? "" : "登録できる工具マスタがありません。管理者に確認してください。";
      group.focus();
    } catch (error) {
      message.textContent = error.message;
    } finally {
      open.disabled = false;
    }
  });
  cancel.addEventListener("click", () => {
    if (busy) return;
    form.classList.add("hidden");
    open.setAttribute("aria-expanded", "false");
    open.focus();
  });
  form.addEventListener("submit", async event => {
    event.preventDefault();
    if (busy || !form.reportValidity()) return;
    if (group.value !== "充電工具" && !allowedCategories.includes(category.value)) {
      message.textContent = "点検区分を選択してください";
      return;
    }
    busy = true;
    save.disabled = cancel.disabled = open.disabled = true;
    message.textContent = "登録しています…";
    try {
      const tool = await ToolRegistration.registerPersonal({
        p_group: group.value, p_name: name.value,
        p_specification: form.elements.specification.value.trim(),
        p_note: form.elements.note.value.trim(), p_lathe_size: size.value || null,
        p_inspection_category: group.value === "充電工具" ? null : category.value,
        p_manufacturer: form.elements.manufacturer.value.trim() || null,
        p_model_number: form.elements.modelNumber.value.trim() || null,
        p_serial_number: form.elements.serialNumber.value.trim() || null,
        p_performance: form.elements.performance.value.trim() || null
      });
      form.reset();
      form.classList.add("hidden");
      open.setAttribute("aria-expanded", "false");
      message.textContent = `工具を登録しました（管理番号：${tool.management_code}）`;
      try {
        await refreshList(tool.assigned_employee_id);
      } catch (error) {
        message.textContent += `。一覧の更新に失敗しました：${error.message}。再登録せず、一覧を再表示してください。`;
      }
    } catch (error) {
      message.textContent = `登録できませんでした：${error.message}`;
    } finally {
      busy = false;
      cancel.disabled = open.disabled = false;
      updateName();
    }
  });
};
