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

const employeeAdminProfileFields =
  document.getElementById(
    "employeeAdminProfileFields"
  );

const employeeJobTitle =
  document.getElementById(
    "employeeJobTitle"
  );

const employeeProfileEmail =
  document.getElementById(
    "employeeProfileEmail"
  );

const employeePhoneNumber =
  document.getElementById(
    "employeePhoneNumber"
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

const employeePasswordResetSection =
  document.getElementById(
    "employeePasswordResetSection"
  );

const employeeResetPassword =
  document.getElementById(
    "employeeResetPassword"
  );

const employeeResetPasswordConfirmation =
  document.getElementById(
    "employeeResetPasswordConfirmation"
  );

const resetEmployeePasswordButton =
  document.getElementById(
    "resetEmployeePasswordButton"
  );

const employeePasswordResetMessage =
  document.getElementById(
    "employeePasswordResetMessage"
  );


/* =========================================
   現在使用中のデータ
========================================= */

let employeeRecords = [];
let isEmployeePasswordResetting = false;


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

  return true;
}


let employeeEditAccess = null;
let employeeReadOnly = false;
const lockedEmployeeControls = new Map();
function lockEmployeeEditing(locked) {
  if (locked) {
    employeeEditSection.hidden = true;
    window.EmployeeVehicleAdmin?.close();
    window.EmployeeFuelReceiptRole?.close();
    for (const control of employeeEditSection.querySelectorAll('input,select,textarea,button')) {
      if (!lockedEmployeeControls.has(control)) lockedEmployeeControls.set(control, control.disabled);
      control.disabled = true;
    }
  } else {
    for (const [control, disabled] of lockedEmployeeControls) control.disabled = disabled;
    lockedEmployeeControls.clear();
  }
}
function requireEmployeeEditing() {
  if (employeeReadOnly || !employeeEditAccess) throw new Error('社員編集の権限を確認できません。閲覧専用では変更できません。');
}
function employeeRequestError(response, data) {
  const code = typeof data?.code === 'string' ? data.code : '';
  let message;
  if (response.status === 401) message = '認証に失敗しました。ログイン状態を確認してください。';
  else if (response.status === 403 || code === '42501') message = '社員情報を操作・取得する権限がありません。';
  else if (response.status === 404 && code === 'PGRST202') message = '社員編集用RPCが未導入です。';
  else if (data?.message?.includes('conflict')) message = '社員情報が変更されています。編集を開き直して確認してください。';
  else message = '社員情報を保存・取得できません。接続先のRPCと依存関係を確認してください。';
  const error = new Error(`${message}（HTTP ${response.status}${code ? ' / ' + code : ''}）`);
  error.code = code; error.status = response.status;
  return error;
}
const employeeEditKeys = ['name','attendance_required','improvement_required','near_miss_required'];
const employeeAdminKeys = [...employeeEditKeys,'department','active','admin_scope','job_title','profile_email','phone_number','driving_report_required'];
async function employeeManagementRpc(name, body = {}) {
  if (name !== 'employee_edit_context') requireEmployeeEditing();
  const response = await portalFetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body)
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw employeeRequestError(response, data);
  if (!data || typeof data !== 'object') throw new Error('社員管理RPCの応答を確認できません。');
  return data;
}
function applyEmployeeEditAccess() {
  const all = employeeEditAccess?.all === true;
  newEmployeeButton.hidden = !all;
  newEmployeeButton.disabled = !all || employeeEditAccess?.creation_enabled !== true;
  document.getElementById('employeeCreationRecovery').hidden = !all || employeeEditAccess?.creation_management_enabled !== true;
  document.getElementById('employeeCreationNotice').textContent = employeeReadOnly
    ? '閲覧専用です。社員の登録・編集・削除はできません。'
    : employeeEditAccess?.creation_enabled === true
    ? '未完了の登録は状況を確認してから対応してください。'
    : '社員登録は安全性・復旧手順の確認まで停止中です。既存社員の編集は利用できます。';
  document.getElementById('employeeDrivingRequiredField').hidden = !all;
  for (const el of [employeeDepartment, employeeActive, employeeAdminScope, document.getElementById('employeeDrivingRequired')]) el.disabled = !all;
  deleteEmployeeButton.hidden = true;
  deleteEmployeeButton.disabled = true;
}

async function refreshEmployeeManagement() {
  clearMessage();
  employeeEditAccess = null;
  employeeReadOnly = false;
  employeeRecords = [];
  employeeList.replaceChildren();
  lockEmployeeEditing(true);
  applyEmployeeEditAccess();
  try {
    const context = await employeeManagementRpc('employee_edit_context');
    if (typeof context.all !== 'boolean' || !Array.isArray(context.editable_ids)) throw new Error('社員編集権限の応答が不正です。');
    employeeEditAccess = context;
    lockEmployeeEditing(false);
  } catch (error) {
    if (error.status !== 404 || error.code !== 'PGRST202') throw error;
    employeeReadOnly = true;
    showMessage('社員編集用RPCが未導入のため閲覧専用です。社員情報・権限・管理車両の変更、登録・削除はできません。');
  }
  applyEmployeeEditAccess();
  await loadEmployees();
}
async function showEmployeeCreationStatus() {
  if (employeeEditAccess?.creation_management_enabled !== true) return;
  const message = document.getElementById('employeeCreationStatusMessage');
  const list = document.getElementById('employeeCreationStatusList');
  list.replaceChildren();
  message.textContent = '登録状況を確認しています…';
  try {
    const operationId = document.getElementById('employeeCreationOperationId')?.value.trim();
    const response = await portalFetch(`${SUPABASE_URL}/functions/v1/bright-service`, {
      method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'creation_status',...(operationId ? {operationId} : {})})
    });
    const data = await response.json();
    if (!response.ok || !Array.isArray(data.operations)) throw Error('登録状況を確認できません。再登録せず管理者へ連絡してください。');
    for (const row of data.operations) {
      const item = document.createElement('li');
    const labels = {completed:'登録完了',employee_created:'旧方式・処理中または中断・要確認',recovery_required:'復旧確認が必要',auth_creating:'Auth作成中または結果未確認',auth_bound:'隔離・紐付け済み',releasing:'解放結果の確認待ち'};
      item.textContent = `社員ID ${row.employee_id} ／ ${labels[row.state] || '状態要確認'} ／ 操作ID ${row.operation_id}`;
      if (['auth_creating','auth_bound','releasing'].includes(row.state)) {
        const password = document.createElement('input');
        password.type = 'password'; password.autocomplete = 'new-password';
        password.placeholder = '初期パスワード（隔離済みAuthの解放時のみ必要）';
        password.setAttribute('aria-label', `社員ID ${row.employee_id}の復旧用初期パスワード`);
        password.minLength = 8; password.maxLength = 128;
        const recover = document.createElement('button');
        recover.type = 'button'; recover.textContent = '登録結果を照合・限定復旧';
        recover.onclick = async () => {
          if (!isAllEmployeeAdministrator() || employeeEditAccess?.creation_management_enabled !== true) return;
          if (!window.confirm('同じ操作ID・既存Authを照合します。Authの再作成や完全削除は行いません。隔離済みの場合のみ入力した初期パスワードで解放します。よろしいですか？')) return;
          recover.disabled = true;
          try {
            const initialPassword = password.value; password.value = '';
            const response = await portalFetch(`${SUPABASE_URL}/functions/v1/bright-service`, {
              method:'POST',headers:{'Content-Type':'application/json'},
              body:JSON.stringify({action:'recover_creation',operationId:row.operation_id,initialPassword})
            });
            const result = await response.json();
            if (!response.ok || result.success !== true) throw Error(result.error || '復旧結果を確認できません。別操作で再登録しないでください。');
            await refreshEmployeeManagement();
            await showEmployeeCreationStatus();
            message.textContent = '登録完了を確認しました。社員・車両情報は保持されています。';
          } catch (error) { message.textContent = error.message; }
          finally { password.value = ''; recover.disabled = false; }
        };
        item.append(password, recover);
      }
      list.append(item);
    }
    message.textContent = `${operationId ? '指定した操作IDの結果です。' : '最新50件です。'}未完了の登録は別の操作として作り直さず、操作IDで照合してください。`;
    if (localStorage.getItem('employeeCreationPendingOperation')) message.textContent += ' このブラウザーには旧方式の未完了操作IDも残っています。削除せず確認してください。';
  } catch (error) { message.textContent = error.message; }
}
document.getElementById('employeeCreationStatusButton').addEventListener('click', showEmployeeCreationStatus);

function isAllEmployeeAdministrator() {
  return employeeEditAccess?.all === true;
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
      const data = await response.json().catch(() => null);
      throw employeeRequestError(response, data);
    }

    const records = await response.json();
    if (!Array.isArray(records)) throw new Error('社員一覧の応答が不正です。');
    employeeRecords = records;

    displayEmployees();

  } catch (error) {
    console.error(error);
    employeeRecords = [];
    showMessage(error.message);

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

        <p>
          運転日報：
          ${escapeHtml(
            formatTarget(
              employee.driving_report_required
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

  editButton.disabled = !employeeEditAccess?.editable_ids?.some(id => String(id) === String(employee.id));
  editButton.hidden = employeeReadOnly;
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
  if (!isAllEmployeeAdministrator() || employeeEditAccess?.creation_enabled !== true) { showMessage('社員登録は停止中です。登録状況を確認してください。'); return; }
  applyEmployeeEditAccess();
  window.EmployeeVehicleAdmin?.close();
  window.EmployeeFuelReceiptRole?.close();
  document.getElementById('employeeDrivingRequiredField').hidden = true;
  editingEmployeeId.value =
    "";

  employeeFormTitle.textContent =
    "新規社員登録";

  employeeName.value =
    "";

  employeeDepartment.value =
    "工事部";

  employeeJobTitle.value = "";
  employeeProfileEmail.value = "";
  employeePhoneNumber.value = "";
  employeeAdminProfileFields.hidden = true;

  employeeInitialPassword.value =
    "";

  employeeInitialPasswordWrap.hidden =
    false;

  employeeResetPassword.value = "";
  employeeResetPasswordConfirmation.value = "";
  employeePasswordResetMessage.textContent = "";
  employeePasswordResetSection.hidden = true;

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
  if (!employeeEditAccess?.editable_ids?.some(id => String(id) === String(employee.id))) {
    showMessage('この社員は編集対象外です。追加管理権限または担当部署を確認してください。');
    return;
  }
  applyEmployeeEditAccess();

  window.EmployeeVehicleAdmin?.open(employee.id);
  window.EmployeeFuelReceiptRole?.open(employee.id);
  editingEmployeeId.value =
    employee.id;

  employeeFormTitle.textContent =
    "社員情報の修正";

  document.getElementById('employeeDrivingRequired').value = String(employee.driving_report_required === true);
  employeeName.value =
    employee.name || "";

  employeeDepartment.value =
    employee.department ||
    "工事部";

  employeeJobTitle.value =
    employee.job_title || "";

  employeeProfileEmail.value =
    employee.profile_email || "";

  employeePhoneNumber.value =
    employee.phone_number || "";

  const canManageEmployeeProfile =
    isAllEmployeeAdministrator();

  employeeAdminProfileFields.hidden =
    !canManageEmployeeProfile;

  employeeInitialPassword.value =
    "";

  employeeInitialPasswordWrap.hidden =
    true;

  employeeResetPassword.value = "";
  employeeResetPasswordConfirmation.value = "";
  employeePasswordResetMessage.textContent = "";
  employeePasswordResetSection.hidden =
    !canManageEmployeeProfile;

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

  deleteEmployeeButton.hidden = true;
  deleteEmployeeButton.disabled = true;

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


function createEmployeeAdministrativeData() {
  return {
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


function createEmployeeProfileData(
  employeeId
) {
  return {
    employeeId:
      Number(employeeId),

    name:
      employeeName.value,

    department:
      employeeDepartment.value,

    job_title:
      employeeJobTitle.value,

    profile_email:
      employeeProfileEmail.value,

    phone_number:
      employeePhoneNumber.value
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
      password.length < 8
    ) {
      throw new Error(
        "初期パスワードは8文字以上で入力してください"
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
  if (!isAllEmployeeAdministrator() || employeeEditAccess?.creation_enabled !== true) throw new Error('社員登録は停止中です。登録状況を確認してください。');
  const operation = await EmployeeCreationState.acquire(employeeEditAccess.actor_id, updateData);
  const operationId = operation.operationId;
  const url =
    `${SUPABASE_URL}` +
    `/functions/v1/bright-service`;

  let response;
  try {
    response = await portalFetch(
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
            operationId,

            ...updateData,

            initialPassword:
              employeeInitialPassword.value
          })
      }
    );
  } catch {
    throw new Error('登録結果を確認できません。再登録前に操作IDを確認してください: ' + operationId);
  }

  const responseData =
    await response.json()
      .catch(
        () => ({})
      );

  await EmployeeCreationState.record(operation, responseData);
  if (!response.ok) {
    responseData.error = (responseData.error || "登録結果を確認できません") + " 操作ID: " + operationId;

    throw new Error(
      responseData.error ||
      responseData.message ||
      "新規社員を登録できませんでした"
    );
  }

  if (responseData.success !== true) throw new Error('登録完了を確認できません。操作ID: ' + operationId);
  return responseData;
}


/* =========================================
   既存社員情報更新
========================================= */

async function updateExistingEmployee(employeeId, updateData) {
  requireEmployeeEditing();
  const all = isAllEmployeeAdministrator();
  const keys = all ? employeeAdminKeys : employeeEditKeys;
  const old = employeeRecords.find(e => String(e.id) === String(employeeId));
  if (!old) throw new Error('社員情報を読み込み直してください。');
  const expected = Object.fromEntries(keys.map(k => [k, old[k] ?? null]));
  const data = Object.fromEntries(keys.map(k => [k, updateData[k]]));
  return employeeManagementRpc(all ? 'admin_edit_employee' : 'department_edit_employee', {
    p_id:Number(employeeId), p_data:data, p_expected:expected
  });
}

async function updateEmployeeProfileAsAdmin(
  employeeId
) {
  requireEmployeeEditing();
  const response =
    await portalFetch(
      `${SUPABASE_URL}` +
      `/functions/v1/admin-update-employee-profile`,
      {
        method: "POST",
        headers: {
          "Content-Type":
            "application/json"
        },
        body:
          JSON.stringify(
            createEmployeeProfileData(
              employeeId
            )
          )
      }
    );

  const responseData =
    await response.json()
      .catch(() => ({}));

  if (!response.ok) {
    throw new Error(
      responseData.error ||
      "社員プロフィールを更新できませんでした"
    );
  }

  return responseData.employee;
}


/* =========================================
   全体管理者によるパスワード再発行
========================================= */

async function resetEmployeePassword() {
  if (isEmployeePasswordResetting) {
    return;
  }

  const employeeId =
    editingEmployeeId.value;

  if (
    !employeeId ||
    !isAllEmployeeAdministrator()
  ) {
    return;
  }

  const newPassword =
    employeeResetPassword.value;

  const confirmation =
    employeeResetPasswordConfirmation.value;

  employeePasswordResetMessage.textContent = "";

  if (!newPassword || !confirmation) {
    employeePasswordResetMessage.textContent =
      "2つのパスワードを入力してください。";
    return;
  }

  if (newPassword !== confirmation) {
    employeePasswordResetMessage.textContent =
      "入力したパスワードが一致しません。";
    return;
  }

  if (newPassword.length < 8) {
    employeePasswordResetMessage.textContent =
      "パスワードは8文字以上で入力してください。";
    return;
  }

  if (newPassword.length > 128) {
    employeePasswordResetMessage.textContent =
      "パスワードは128文字以内で入力してください。";
    return;
  }

  const confirmed =
    window.confirm(
      "この社員のログインパスワードを変更します。よろしいですか？"
    );

  if (!confirmed) {
    return;
  }

  isEmployeePasswordResetting = true;
  resetEmployeePasswordButton.disabled = true;
  resetEmployeePasswordButton.textContent =
    "再発行中...";

  try {
    const response =
      await portalFetch(
        `${SUPABASE_URL}` +
        `/functions/v1/admin-reset-employee-password`,
        {
          method: "POST",
          headers: {
            "Content-Type":
              "application/json"
          },
          body:
            JSON.stringify({
              employeeId:
                Number(employeeId),
              newPassword:
                newPassword
            })
        }
      );

    const responseData =
      await response.json()
        .catch(() => ({}));

    if (!response.ok) {
      throw new Error(
        responseData.error ||
        "パスワードを再発行できませんでした"
      );
    }

    employeeResetPassword.value = "";
    employeeResetPasswordConfirmation.value = "";
    employeePasswordResetMessage.textContent =
      responseData.message ||
      "パスワードを再発行しました";

  } catch (error) {
    console.error(error);

    employeePasswordResetMessage.textContent =
      error.message ||
      "パスワードを再発行できませんでした。";

  } finally {
    isEmployeePasswordResetting = false;
    resetEmployeePasswordButton.disabled = false;
    resetEmployeePasswordButton.textContent =
      "パスワードを再発行";
  }
}


/* =========================================
   社員完全削除
========================================= */

async function deleteEmployeeAccount() {
  showMessage('完全削除は安全性確認まで停止中です。退職者は使用停止にしてください。');
}


/* =========================================
   社員情報保存
========================================= */

async function saveEmployee() {
  if (employeeReadOnly || !employeeEditAccess) { showMessage('社員編集の権限を確認できません。閲覧専用では変更できません。'); return; }
  if (saveEmployeeButton.disabled) return;
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

  let receiptRoleChange;
  try {
    receiptRoleChange = isNewEmployee ? null : await window.EmployeeFuelReceiptRole?.prepare(employeeId);
  } catch (error) { showMessage(error.message); return; }

  if (saveEmployeeButton.disabled) return;
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
      const creationResult = await createNewEmployeeAccount(updateData);
      await refreshEmployeeManagement();

      closeEmployeeEdit();

      alert(
        creationResult.replayed ? '登録済みの操作結果を確認しました。初期パスワードは変更していません。' : '新規社員を登録しました。使用中の場合はログイン可能です。'
      );

      showMessage(
        creationResult.replayed ? '登録済みの操作結果を確認しました。' : '新規社員を登録しました。'
      );

      return;
    }


    /*
      既存社員
    */

    const savedData = await updateExistingEmployee(employeeId, {
      ...updateData,
      driving_report_required: document.getElementById('employeeDrivingRequired').value === 'true',
      job_title: employeeJobTitle.value,
      profile_email: employeeProfileEmail.value,
      phone_number: employeePhoneNumber.value
    });

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

        ...savedData
      };
    }

    displayEmployees();

    try {
      await window.EmployeeFuelReceiptRole?.save(receiptRoleChange);
    } catch (error) {
      throw new Error('社員情報は保存済みですが、給油領収書管理権限の保存を確認できません。編集画面の入力を保持しています。再度編集を開き、社員情報と権限の両方を確認してください。 ' + error.message);
    }

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
  window.EmployeeVehicleAdmin?.close();
  window.EmployeeFuelReceiptRole?.close();
  editingEmployeeId.value =
    "";

  employeeName.value =
    "";

  employeeJobTitle.value = "";
  employeeProfileEmail.value = "";
  employeePhoneNumber.value = "";
  employeeAdminProfileFields.hidden = true;

  employeeInitialPassword.value =
    "";

  employeeInitialPasswordWrap.hidden =
    true;

  employeeResetPassword.value = "";
  employeeResetPasswordConfirmation.value = "";
  employeePasswordResetMessage.textContent = "";
  employeePasswordResetSection.hidden = true;

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


resetEmployeePasswordButton.addEventListener(
  "click",
  resetEmployeePassword
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

  try {
    await refreshEmployeeManagement();
  } catch (error) {
    newEmployeeButton.hidden = true;
    showMessage(error.message);
  }
}


initializeEmployeeAdmin();
