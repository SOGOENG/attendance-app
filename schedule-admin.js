/* =========================================
   予定管理画面
========================================= */

const SUPABASE_URL =
  "https://fgmvmbjnoyagnpygcbky.supabase.co";


/* =========================================
   HTML要素
========================================= */

const scheduleDate =
  document.getElementById("scheduleDate");

const scheduleStartTime =
  document.getElementById("scheduleStartTime");

const scheduleTitle =
  document.getElementById("scheduleTitle");

const scheduleDetails =
  document.getElementById("scheduleDetails");

const scheduleTargetScope =
  document.getElementById("scheduleTargetScope");

const addScheduleButton =
  document.getElementById("addSchedule");

const cancelScheduleEditButton =
  document.getElementById("cancelScheduleEdit");

const scheduleMessage =
  document.getElementById("scheduleMessage");

const scheduleFormTitle =
  document.getElementById("scheduleFormTitle");

const editingScheduleId =
  document.getElementById("editingScheduleId");

const adminScheduleList =
  document.getElementById("adminScheduleList");


/* =========================================
   管理者権限確認
========================================= */

function getLoginUser() {
  const savedUser =
    localStorage.getItem("portalLoginUser");

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
      "予定管理を開く権限がありません"
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
  scheduleMessage.textContent =
    message;
}


function clearMessage() {
  scheduleMessage.textContent =
    "";
}


/* =========================================
   入力内容取得
========================================= */

function createScheduleData() {
  return {
    schedule_date:
      scheduleDate.value,

    start_time:
      scheduleStartTime.value || null,

    title:
      scheduleTitle.value.trim(),

    details:
      scheduleDetails.value.trim(),

    target_scope:
      scheduleTargetScope.value || "all"
  };
}


/* =========================================
   入力確認
========================================= */

function validateSchedule() {
  if (!scheduleDate.value) {
    throw new Error(
      "日付を選択してください"
    );
  }

  if (!scheduleTitle.value.trim()) {
    throw new Error(
      "予定名を入力してください"
    );
  }
}


/* =========================================
   予定登録・更新
========================================= */

async function saveSchedule() {
  clearMessage();

  try {
    validateSchedule();

  } catch (error) {
    showMessage(error.message);
    return;
  }

  const editingId =
    editingScheduleId.value;

  const isEditing =
    Boolean(editingId);

  addScheduleButton.disabled =
    true;

  addScheduleButton.textContent =
    isEditing
      ? "更新中..."
      : "登録中...";

  let url =
    `${SUPABASE_URL}/rest/v1/schedules`;

  let method =
    "POST";

  if (isEditing) {
    url +=
      `?id=eq.${editingId}`;

    method =
      "PATCH";
  }

  try {
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
              createScheduleData()
            )
        }
      );

    if (!response.ok) {
      const errorText =
        await response.text();

      console.error(errorText);

      throw new Error(
        isEditing
          ? "予定の更新に失敗しました"
          : "予定の登録に失敗しました"
      );
    }

    resetScheduleForm();

    showMessage(
      isEditing
        ? "予定を更新しました"
        : "予定を登録しました"
    );

    await loadSchedules();

  } catch (error) {
    console.error(error);

    showMessage(
      error.message
    );

  } finally {
    addScheduleButton.disabled =
      false;

    addScheduleButton.textContent =
      editingScheduleId.value
        ? "予定を更新"
        : "予定を登録";
  }
}


/* =========================================
   入力フォーム初期化
========================================= */

function resetScheduleForm() {
  editingScheduleId.value =
    "";

  scheduleDate.value =
    "";

  scheduleStartTime.value =
    "";

  scheduleTitle.value =
    "";

  scheduleDetails.value =
    "";

  scheduleTargetScope.value =
    "all";

  scheduleFormTitle.textContent =
    "予定登録";

  addScheduleButton.textContent =
    "予定を登録";

  cancelScheduleEditButton.hidden =
    true;
}


/* =========================================
   予定一覧取得
========================================= */

async function loadSchedules() {
  adminScheduleList.innerHTML =
    `
      <p class="schedule-empty-message">
        予定を読み込み中...
      </p>
    `;

  try {
    const url =
      `${SUPABASE_URL}/rest/v1/schedules` +
      `?select=*` +
      `&order=schedule_date.desc,start_time.asc`;

    const response =
      await portalFetch(url);

    if (!response.ok) {
      const errorText =
        await response.text();

      console.error(errorText);

      throw new Error(
        "予定の読み込みに失敗しました"
      );
    }

    const schedules =
      await response.json();

    renderSchedules(
      schedules
    );

  } catch (error) {
    console.error(error);

    adminScheduleList.innerHTML =
      `
        <p class="schedule-empty-message">
          ${escapeHtml(error.message)}
        </p>
      `;
  }
}


/* =========================================
   予定一覧表示
========================================= */

function renderSchedules(schedules) {
  adminScheduleList.innerHTML =
    "";

  if (schedules.length === 0) {
    adminScheduleList.innerHTML =
      `
        <p class="schedule-empty-message">
          登録済みの予定はありません
        </p>
      `;

    return;
  }

  schedules.forEach(schedule => {
    const item =
      createScheduleItem(schedule);

    adminScheduleList.appendChild(
      item
    );
  });
}


/* =========================================
   予定カード作成
========================================= */

function createScheduleItem(schedule) {
  const item =
    document.createElement("div");

  item.className =
    "admin-schedule-item";

  const timeText =
    schedule.start_time
      ? schedule.start_time.slice(0, 5)
      : "時間未定";

  const targetText =
    schedule.target_scope === "all"
      ? "全員"
      : schedule.target_scope;

  item.innerHTML =
    `
      <div class="admin-schedule-info">

        <strong>
          ${escapeHtml(schedule.title)}
        </strong>

        <p>
          ${escapeHtml(schedule.schedule_date)}
          ／
          ${escapeHtml(timeText)}
        </p>

        <p>
          対象：
          ${escapeHtml(targetText)}
        </p>

        ${
          schedule.details
            ? `
              <p>
                ${escapeHtml(schedule.details)}
              </p>
            `
            : ""
        }

      </div>

      <div class="admin-schedule-actions">

        <button
          type="button"
          class="edit-schedule-button"
        >
          編集
        </button>

        <button
          type="button"
          class="delete-schedule-button"
        >
          削除
        </button>

      </div>
    `;

  const editButton =
    item.querySelector(
      ".edit-schedule-button"
    );

  const deleteButton =
    item.querySelector(
      ".delete-schedule-button"
    );

  editButton.addEventListener(
    "click",
    () => {
      startScheduleEdit(
        schedule
      );
    }
  );

  deleteButton.addEventListener(
    "click",
    () => {
      deleteSchedule(
        schedule
      );
    }
  );

  return item;
}


/* =========================================
   予定編集開始
========================================= */

function startScheduleEdit(schedule) {
  editingScheduleId.value =
    schedule.id;

  scheduleDate.value =
    schedule.schedule_date || "";

  scheduleStartTime.value =
    schedule.start_time
      ? schedule.start_time.slice(0, 5)
      : "";

  scheduleTitle.value =
    schedule.title || "";

  scheduleDetails.value =
    schedule.details || "";

  scheduleTargetScope.value =
    schedule.target_scope || "all";

  scheduleFormTitle.textContent =
    "予定編集";

  addScheduleButton.textContent =
    "予定を更新";

  cancelScheduleEditButton.hidden =
    false;

  clearMessage();

  scheduleFormTitle.scrollIntoView({
    behavior:
      "smooth",

    block:
      "start"
  });
}


/* =========================================
   予定削除
========================================= */

async function deleteSchedule(schedule) {
  const confirmed =
    window.confirm(
      `「${schedule.title}」を削除しますか？`
    );

  if (!confirmed) {
    return;
  }

  try {
    const url =
      `${SUPABASE_URL}/rest/v1/schedules` +
      `?id=eq.${schedule.id}`;

    const response =
      await portalFetch(
        url,
        {
          method:
            "DELETE",

          headers: {
            Prefer:
              "return=minimal"
          }
        }
      );

    if (!response.ok) {
      const errorText =
        await response.text();

      console.error(errorText);

      throw new Error(
        "予定の削除に失敗しました"
      );
    }

    if (
      String(editingScheduleId.value) ===
      String(schedule.id)
    ) {
      resetScheduleForm();
    }

    showMessage(
      "予定を削除しました"
    );

    await loadSchedules();

  } catch (error) {
    console.error(error);

    showMessage(
      error.message
    );
  }
}


/* =========================================
   イベント設定
========================================= */

addScheduleButton.addEventListener(
  "click",
  saveSchedule
);


cancelScheduleEditButton.addEventListener(
  "click",
  () => {
    resetScheduleForm();

    clearMessage();
  }
);


/* =========================================
   初期表示
========================================= */

async function initializeScheduleAdmin() {
  if (!checkAdminAccess()) {
    return;
  }

  await loadSchedules();
}


initializeScheduleAdmin();