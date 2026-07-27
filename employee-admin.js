/* =========================================
   社員設定
========================================= */

const SUPABASE_URL =
  "https://fgmvmbjnoyagnpygcbky.supabase.co";


/* =========================================
   HTML要素
========================================= */

const employeeDepartmentFilter =
  document.getElementById(
    "employeeDepartmentFilter"
  );

const employeeNameSearch =
  document.getElementById(
    "employeeNameSearch"
  );

const newEmployeeButton =
  document.getElementById(
    "newEmployeeButton"
  );  

const employeeMessage =
  document.getElementById(
    "employeeMessage"
  );

const employeeList =
  document.getElementById(
    "employeeList"
  );

const employeeEditSection =
  document.getElementById(
    "employeeEditSection"
  );

const employeeFormTitle =
  document.getElementById(
    "employeeFormTitle"
  );  

const editingEmployeeId =
  document.getElementById(
    "editingEmployeeId"
  );

const employeeName =
  document.getElementById(
    "employeeName"
  );

const employeeDepartment =
  document.getElementById(
    "employeeDepartment"
  );

const employeeActive =
  document.getElementById(
    "employeeActive"
  );

const employeeAdminScope =
  document.getElementById(
    "employeeAdminScope"
  );

const employeeAttendanceRequired =
  document.getElementById(
    "employeeAttendanceRequired"
  );

const employeeImprovementRequired =
  document.getElementById(
    "employeeImprovementRequired"
  );

const employeeNearMissRequired =
  document.getElementById(
    "employeeNearMissRequired"
  );

const saveEmployeeButton =
  document.getElementById(
    "saveEmployeeButton"
  );

const cancelEmployeeEditButton =
  document.getElementById(
    "cancelEmployeeEditButton"
  );


/* =========================================
   現在使用中のデータ
========================================= */

let employeeRecords = [];


/* =========================================
   管理者権限確認
========================================= */

function getLoginUser() {
  const savedUser =
    localStorage.getItem(
      "portalLoginUser"
    );

  if (!savedUser) {
    return null;
  }

  try {
    return JSON.parse(savedUser);

  } catch (error) {
    console.error(error);
    return null;
  }
}


function checkAdminAccess() {
  const loginUser =
    getLoginUser();

  if (!loginUser) {
    window.location.href =
      "login.html";

    return false;
  }

  if (
    !loginUser.adminScope ||
    loginUser.adminScope === "none"
  ) {
    alert(
      "社員設定を開く権限がありません"
    );

    window.location.href =
      "home.html";

    return false;
  }

  return true;
}


/* =========================================
   共通処理
========================================= */

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}


function showMessage(message) {
  employeeMessage.textContent =
    message;
}


function clearMessage() {
  employeeMessage.textContent =
    "";
}


function formatTarget(value) {
  return value
    ? "対象"
    : "対象外";
}


function formatActive(value) {
  return value
    ? "使用中"
    : "使用停止";
}


function formatAdminScope(value) {
  if (!value || value === "none") {
    return "権限なし";
  }

  if (value === "all") {
    return "全体管理者";
  }

  return `${value}のみ`;
}


/* =========================================
   社員一覧取得
========================================= */

async function loadEmployees() {
  employeeList.innerHTML =
    `
      <p class="schedule-empty-message">
        社員情報を読み込み中...
      </p>
    `;

  try {
    const url =
  `${SUPABASE_URL}/rest/v1/employees` +
  `?select=*` +
  `&order=department.asc,name.asc`;

    const response =
      await portalFetch(url);

    if (!response.ok) {
      const errorText =
        await response.text();

      console.error(errorText);

      throw new Error(
        "社員情報を読み込めませんでした"
      );
    }

    employeeRecords =
      await response.json();

    displayEmployees();

  } catch (error) {
    console.error(error);

    employeeList.innerHTML =
      `
        <p class="schedule-empty-message">
          ${escapeHtml(error.message)}
        </p>
      `;
  }
}


/* =========================================
   絞り込み済み社員取得
========================================= */

function getFilteredEmployees() {
  const selectedDepartment =
    employeeDepartmentFilter.value;

  const searchText =
    employeeNameSearch.value
      .trim()
      .toLowerCase();

  return employeeRecords.filter(
    employee => {
      const departmentMatches =
        selectedDepartment === "all" ||
        employee.department ===
          selectedDepartment;

      const nameMatches =
        !searchText ||
        String(employee.name || "")
          .toLowerCase()
          .includes(searchText);

      return (
        departmentMatches &&
        nameMatches
      );
    }
  );
}


/* =========================================
   社員一覧表示
========================================= */

function displayEmployees() {
  const filteredEmployees =
    getFilteredEmployees();

  employeeList.innerHTML =
    "";

  if (
    filteredEmployees.length === 0
  ) {
    employeeList.innerHTML =
      `
        <p class="schedule-empty-message">
          該当する社員はいません
        </p>
      `;

    return;
  }

  filteredEmployees.forEach(
    employee => {
      const card =
        createEmployeeCard(employee);

      employeeList.appendChild(
        card
      );
    }
  );
}


/* =========================================
   社員カード作成
========================================= */

function createEmployeeCard(employee) {
  const card =
    document.createElement("div");

  card.className =
    "admin-schedule-item";

  card.innerHTML =
    `
      <div class="admin-schedule-info">

        <strong>
          ${escapeHtml(employee.name)}
        </strong>

        <p>
          部署：
          ${escapeHtml(employee.department)}
        </p>

        <p>
          状態：
          ${escapeHtml(
            formatActive(employee.active)
          )}
        </p>

        <p>
          管理者：
          ${escapeHtml(
            formatAdminScope(
              employee.admin_scope
            )
          )}
        </p>

        <p>
          出勤簿：
          ${escapeHtml(
            formatTarget(
              employee.attendance_required
            )
          )}
        </p>

        <p>
          向上提案：
          ${escapeHtml(
            formatTarget(
              employee.improvement_required
            )
          )}
        </p>

        <p>
          ヒヤリ：
          ${escapeHtml(
            formatTarget(
              employee.near_miss_required
            )
          )}
        </p>

      </div>

      <div class="admin-schedule-actions">

        <button
          type="button"
          class="edit-schedule-button"
        >
          編集
        </button>

      </div>
    `;

  const editButton =
    card.querySelector(
      ".edit-schedule-button"
    );

  editButton.addEventListener(
    "click",
    () => {
      startEmployeeEdit(
        employee
      );
    }
  );

  return card;
}

/* =========================================
   新規社員登録開始
========================================= */

function startNewEmployeeRegistration() {
  editingEmployeeId.value =
    "";

  employeeFormTitle.textContent =
    "新規社員登録";

  employeeName.value =
    "";

  employeeDepartment.value =
    "工事部";

  employeeActive.value =
    "true";

  employeeAdminScope.value =
    "none";

  employeeAttendanceRequired.value =
    "true";

  employeeImprovementRequired.value =
    "true";

  employeeNearMissRequired.value =
    "true";

  employeeEditSection.hidden =
    false;

  clearMessage();

  employeeEditSection.scrollIntoView({
    behavior:
      "smooth",

    block:
      "start"
  });
}

/* =========================================
   社員編集開始
========================================= */

function startEmployeeEdit(employee) {
  editingEmployeeId.value =
    employee.id;

  employeeName.value =
    employee.name || "";

  employeeDepartment.value =
    employee.department || "工事部";

  employeeActive.value =
    String(employee.active);

  employeeAdminScope.value =
    employee.admin_scope || "none";

  employeeAttendanceRequired.value =
    String(
      employee.attendance_required
    );

  employeeImprovementRequired.value =
    String(
      employee.improvement_required
    );

  employeeNearMissRequired.value =
    String(
      employee.near_miss_required
    );

  employeeEditSection.hidden =
    false;

  clearMessage();

  employeeEditSection.scrollIntoView({
    behavior:
      "smooth",

    block:
      "start"
  });
}


/* =========================================
   編集内容取得
========================================= */

function createEmployeeUpdateData() {
  return {
    name:
      employeeName.value.trim(),

    department:
      employeeDepartment.value,

    active:
      employeeActive.value === "true",

    admin_scope:
      employeeAdminScope.value,

    attendance_required:
      employeeAttendanceRequired.value ===
      "true",

    improvement_required:
      employeeImprovementRequired.value ===
      "true",

    near_miss_required:
      employeeNearMissRequired.value ===
      "true"
  };
}


/* =========================================
   入力確認
========================================= */

function validateEmployee() {
  if (!employeeName.value.trim()) {
    throw new Error(
      "氏名を入力してください"
    );
  }

  if (!employeeDepartment.value) {
    throw new Error(
      "部署を選択してください"
    );
  }
}


/* =========================================
   社員情報保存
========================================= */

async function saveEmployee() {
  clearMessage();

  try {
    validateEmployee();

  } catch (error) {
    showMessage(
      error.message
    );

    return;
  }

  const employeeId =
    editingEmployeeId.value;

  const isNewEmployee =
    !employeeId;

  const updateData =
    createEmployeeUpdateData();

  const confirmed =
    window.confirm(
      isNewEmployee
        ? "新規社員を登録しますか？"
        : "社員情報を保存しますか？"
    );

  if (!confirmed) {
    return;
  }

  saveEmployeeButton.disabled =
    true;

  saveEmployeeButton.textContent =
    isNewEmployee
      ? "登録中..."
      : "保存中...";

  try {
    let url =
      `${SUPABASE_URL}/rest/v1/employees`;

    let method =
      "POST";

    if (!isNewEmployee) {
      url +=
        `?id=eq.${employeeId}`;

      method =
        "PATCH";
    }

    const response =
      await portalFetch(
        url,
        {
          method,

          headers: {
            "Content-Type":
              "application/json",

            Prefer:
              "return=minimal"
          },

          body:
            JSON.stringify(
              updateData
            )
        }
      );

    if (!response.ok) {
      const errorText =
        await response.text();

      console.error(errorText);

      throw new Error(
        isNewEmployee
          ? "新規社員を登録できませんでした"
          : "社員情報を保存できませんでした"
      );
    }

    if (isNewEmployee) {
      await loadEmployees();

    } else {
      const recordIndex =
        employeeRecords.findIndex(
          employee =>
            String(employee.id) ===
            String(employeeId)
        );

      if (recordIndex !== -1) {
        employeeRecords[recordIndex] = {
          ...employeeRecords[recordIndex],
          ...updateData
        };
      }

      displayEmployees();
    }

    closeEmployeeEdit();

    showMessage(
      isNewEmployee
        ? "新規社員を登録しました"
        : "社員情報を保存しました"
    );

  } catch (error) {
    console.error(error);

    showMessage(
      error.message
    );

  } finally {
    saveEmployeeButton.disabled =
      false;

    saveEmployeeButton.textContent =
      "保存する";
  }
}

/* =========================================
   編集画面を閉じる
========================================= */

function closeEmployeeEdit() {
  editingEmployeeId.value =
    "";

  employeeName.value =
    "";

  employeeFormTitle.textContent =
  "社員情報の修正";  

  employeeEditSection.hidden =
    true;
}


/* =========================================
   イベント設定
========================================= */
newEmployeeButton.addEventListener(
  "click",
  startNewEmployeeRegistration
);

employeeDepartmentFilter.addEventListener(
  "change",
  displayEmployees
);


employeeNameSearch.addEventListener(
  "input",
  displayEmployees
);


saveEmployeeButton.addEventListener(
  "click",
  saveEmployee
);


cancelEmployeeEditButton.addEventListener(
  "click",
  () => {
    closeEmployeeEdit();

    clearMessage();
  }
);


/* =========================================
   初期表示
========================================= */

async function initializeEmployeeAdmin() {
  if (!checkAdminAccess()) {
    return;
  }

  await loadEmployees();
}


initializeEmployeeAdmin();