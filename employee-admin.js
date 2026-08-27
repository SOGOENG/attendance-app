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

const employeeInitialPasswordWrap =
  document.getElementById(
    "employeeInitialPasswordWrap"
  );

const employeeInitialPassword =
  document.getElementById(
    "employeeInitialPassword"
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

const deleteEmployeeButton =
  document.getElementById(
    "deleteEmployeeButton"
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
    return JSON.parse(
      savedUser
    );

  } catch (error) {
    console.error(
      error
    );

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
  loginUser.adminScope === "none" ||
  loginUser.adminScope === "tool_admin"
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
  return String(
    value ?? ""
  )
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
  if (
    !value ||
    value === "none"
  ) {
    return "権限なし";
  }

  if (value === "all") {
    return "全体管理者";
  }

  if (value === "tool_admin") {
  return "工具管理者";
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
        String(
          employee.name || ""
        )
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

  if (
    !employeeDepartmentFilter.value
  ) {
    employeeList.innerHTML =
      `
        <p class="schedule-empty-message">
          部署を選択してください
        </p>
      `;

    return;
  }

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
        createEmployeeCard(
          employee
        );

      employeeList.appendChild(
        card
      );
    }
  );
}


/* =========================================
   社員カード作成
========================================= */

function createEmployeeCard(
  employee
) {
  const card =
    document.createElement(
      "div"
    );

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
            formatActive(
              employee.active
            )
          )}
        </p>

        <p>
          ログイン：
          ${employee.auth_user_id
            ? "登録済"
            : "未登録"}
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

  employeeInitialPassword.value =
    "";

  employeeInitialPasswordWrap.hidden =
    false;

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

  /*
    新規登録では完全削除を出さない
  */

  deleteEmployeeButton.hidden =
    true;

  employeeEditSection.hidden =
    false;

  clearMessage();

  employeeEditSection.scrollIntoView({
    behavior: "smooth",
    block: "start"
  });
}


/* =========================================
   社員編集開始
========================================= */

function startEmployeeEdit(
  employee
) {
  editingEmployeeId.value =
    employee.id;

  employeeFormTitle.textContent =
    "社員情報の修正";

  employeeName.value =
    employee.name || "";

  employeeDepartment.value =
    employee.department ||
    "工事部";

  employeeInitialPassword.value =
    "";

  employeeInitialPasswordWrap.hidden =
    true;

  employeeActive.value =
    String(
      employee.active
    );

  employeeAdminScope.value =
    employee.admin_scope ||
    "none";

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

  /*
    既存社員編集時のみ完全削除を表示
  */

  deleteEmployeeButton.hidden =
    false;

  employeeEditSection.hidden =
    false;

  clearMessage();

  employeeEditSection.scrollIntoView({
    behavior: "smooth",
    block: "start"
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
      employeeActive.value ===
      "true",

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

function validateEmployee(
  isNewEmployee
) {
  if (
    !employeeName.value.trim()
  ) {
    throw new Error(
      "氏名を入力してください"
    );
  }

  if (
    !employeeDepartment.value
  ) {
    throw new Error(
      "部署を選択してください"
    );
  }

  if (isNewEmployee) {
    const password =
      employeeInitialPassword.value;

    if (!password) {
      throw new Error(
        "初期パスワードを入力してください"
      );
    }

    if (
      password.length < 6
    ) {
      throw new Error(
        "初期パスワードは6文字以上で入力してください"
      );
    }
  }
}


/* =========================================
   新規社員＋Auth登録
========================================= */

async function createNewEmployeeAccount(
  updateData
) {
  const url =
    `${SUPABASE_URL}` +
    `/functions/v1/bright-service`;

  const response =
    await portalFetch(
      url,
      {
        method: "POST",

        headers: {
          "Content-Type":
            "application/json"
        },

        body:
          JSON.stringify({
            action: "create",

            ...updateData,

            initialPassword:
              employeeInitialPassword.value
          })
      }
    );

  const responseData =
    await response.json()
      .catch(
        () => ({})
      );

  if (!response.ok) {
    console.error(
      responseData
    );

    throw new Error(
      responseData.error ||
      responseData.message ||
      "新規社員を登録できませんでした"
    );
  }

  return responseData;
}


/* =========================================
   既存社員情報更新
========================================= */

async function updateExistingEmployee(
  employeeId,
  updateData
) {
  const url =
    `${SUPABASE_URL}/rest/v1/employees` +
    `?id=eq.${employeeId}`;

  const response =
    await portalFetch(
      url,
      {
        method: "PATCH",

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
      "社員情報を保存できませんでした"
    );
  }
}


/* =========================================
   社員完全削除
========================================= */

async function deleteEmployeeAccount() {
  const employeeId =
    editingEmployeeId.value;

  if (!employeeId) {
    return;
  }

  const loginUser =
    getLoginUser();

  /*
    自分自身は削除不可
  */

  if (
    loginUser &&
    String(loginUser.id) ===
      String(employeeId)
  ) {
    alert(
      "現在ログイン中の自分自身は削除できません。"
    );

    return;
  }


  /*
    1回目の確認
  */

  const firstConfirmed =
    window.confirm(
      `${employeeName.value}さんを完全削除しますか？\n\n` +
      "通常の退職者は「使用停止」を使用してください。"
    );

  if (!firstConfirmed) {
    return;
  }


  /*
    2回目の確認
  */

  const secondConfirmed =
    window.confirm(
      "本当に完全削除しますか？\n\n" +
      "社員情報とログインアカウントの両方を削除します。\n" +
      "この操作は元に戻せません。"
    );

  if (!secondConfirmed) {
    return;
  }


  deleteEmployeeButton.disabled =
    true;

  deleteEmployeeButton.textContent =
    "削除中...";


  try {
    const url =
      `${SUPABASE_URL}` +
      `/functions/v1/bright-service`;

    const response =
      await portalFetch(
        url,
        {
          method: "POST",

          headers: {
            "Content-Type":
              "application/json"
          },

          body:
            JSON.stringify({
              action: "delete",

              employeeId:
                Number(employeeId)
            })
        }
      );

    const responseData =
      await response.json()
        .catch(
          () => ({})
        );

    if (!response.ok) {
      console.error(
        responseData
      );

      throw new Error(
        responseData.error ||
        responseData.message ||
        "社員を完全削除できませんでした"
      );
    }

    closeEmployeeEdit();

    await loadEmployees();

    alert(
      "社員情報とログインアカウントを完全削除しました。"
    );

    showMessage(
      "社員を完全削除しました"
    );

  } catch (error) {
    console.error(error);

    alert(
      error.message
    );

  } finally {
    deleteEmployeeButton.disabled =
      false;

    deleteEmployeeButton.textContent =
      "完全削除";
  }
}


/* =========================================
   社員情報保存
========================================= */

async function saveEmployee() {
  clearMessage();

  const employeeId =
    editingEmployeeId.value;

  const isNewEmployee =
    !employeeId;

  try {
    validateEmployee(
      isNewEmployee
    );

  } catch (error) {
    showMessage(
      error.message
    );

    return;
  }

  const updateData =
    createEmployeeUpdateData();

  const confirmed =
    window.confirm(
      isNewEmployee
        ? "新規社員を登録しますか？\n\n登録後すぐにログインできるようになります。"
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

    /*
      新規社員
    */

    if (isNewEmployee) {
      await createNewEmployeeAccount(
        updateData
      );

      await loadEmployees();

      closeEmployeeEdit();

      alert(
        "新規社員を登録しました。\n\nログイン可能です。"
      );

      showMessage(
        "新規社員を登録しました。ログイン可能です。"
      );

      return;
    }


    /*
      既存社員
    */

    await updateExistingEmployee(
      employeeId,
      updateData
    );

    const recordIndex =
      employeeRecords.findIndex(
        employee =>
          String(employee.id) ===
          String(employeeId)
      );

    if (
      recordIndex !== -1
    ) {
      employeeRecords[
        recordIndex
      ] = {
        ...employeeRecords[
          recordIndex
        ],

        ...updateData
      };
    }

    displayEmployees();

    closeEmployeeEdit();

    showMessage(
      "社員情報を保存しました"
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

  employeeInitialPassword.value =
    "";

  employeeInitialPasswordWrap.hidden =
    true;

  deleteEmployeeButton.hidden =
    true;

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


deleteEmployeeButton.addEventListener(
  "click",
  deleteEmployeeAccount
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
  if (
    !checkAdminAccess()
  ) {
    return;
  }

  await loadEmployees();
}


initializeEmployeeAdmin();