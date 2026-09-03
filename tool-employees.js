(function() {
  "use strict";

  const DEPARTMENTS = ["工事部", "技術部"];
  const DEFAULT_DEPARTMENT = "工事部";
  const requestNumbers = new WeakMap();

  function initializeDepartmentSelect(select) {
    select.replaceChildren();
    DEPARTMENTS.forEach(department => {
      const option = document.createElement("option");
      option.value = department;
      option.textContent = department;
      select.appendChild(option);
    });
    select.value = DEFAULT_DEPARTMENT;
  }

  function resetEmployeeSelect(select) {
    select.replaceChildren();
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "---- 持出者を選択 ----";
    select.appendChild(option);
    select.value = "";
  }

  async function loadEmployees({
    supabaseUrl,
    departmentSelect,
    employeeSelect
  }) {
    const department = departmentSelect.value || DEFAULT_DEPARTMENT;
    const requestNumber = (requestNumbers.get(employeeSelect) || 0) + 1;
    requestNumbers.set(employeeSelect, requestNumber);
    resetEmployeeSelect(employeeSelect);

    const url =
      `${supabaseUrl}/rest/v1/employees` +
      `?select=id,name,active,department` +
      `&active=eq.true` +
      `&department=eq.${encodeURIComponent(department)}` +
      `&order=name.asc`;
    const response = await portalFetch(url);
    if (!response.ok) {
      throw new Error("社員一覧を読み込めませんでした");
    }

    const employees = await response.json();
    if (
      requestNumbers.get(employeeSelect) !== requestNumber ||
      departmentSelect.value !== department
    ) {
      return;
    }

    employees.forEach(employee => {
      const option = document.createElement("option");
      option.value = employee.id;
      option.textContent = employee.name;
      employeeSelect.appendChild(option);
    });
  }

  window.ToolEmployeeSelector = Object.freeze({
    DEPARTMENTS: Object.freeze([...DEPARTMENTS]),
    DEFAULT_DEPARTMENT,
    initializeDepartmentSelect,
    resetEmployeeSelect,
    loadEmployees
  });
})();
