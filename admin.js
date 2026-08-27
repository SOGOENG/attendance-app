/* =========================================
   管理画面の権限確認
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
  loginUser.adminScope === "none" ||
  loginUser.adminScope === "tool_admin"
) {
  
    alert(
      "管理画面を開く権限がありません"
    );

    window.location.href =
      "home.html";

    return false;
  }

  return true;
}


/* =========================================
   Supabase接続設定
========================================= */

const SUPABASE_URL =
  "https://fgmvmbjnoyagnpygcbky.supabase.co";

/* =========================================
   HTML要素
========================================= */

const scheduleDate =
  document.getElementById(
    "scheduleDate"
  );

const scheduleStartTime =
  document.getElementById(
    "scheduleStartTime"
  );

const scheduleTitle =
  document.getElementById(
    "scheduleTitle"
  );

const scheduleDetails =
  document.getElementById(
    "scheduleDetails"
  );

const scheduleTargetScope =
  document.getElementById(
    "scheduleTargetScope"
  );

const addScheduleButton =
  document.getElementById(
    "addSchedule"
  );

const scheduleMessage =
  document.getElementById(
    "scheduleMessage"
  );

const scheduleFormTitle =
  document.getElementById(
    "scheduleFormTitle"
  );

const editingScheduleId =
  document.getElementById(
    "editingScheduleId"
  );

const cancelScheduleEditButton =
  document.getElementById(
    "cancelScheduleEdit"
  );

const adminScheduleList =
  document.getElementById(
    "adminScheduleList"
  );


/* =========================================
   HTML表示用文字エスケープ
========================================= */

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}


/* =========================================
   予定登録・更新
========================================= */

async function addSchedule() {
  scheduleMessage.textContent = "";

  if (!scheduleDate.value) {
    scheduleMessage.textContent =
      "日付を選択してください";

    return;
  }

  if (!scheduleTitle.value.trim()) {
    scheduleMessage.textContent =
      "予定名を入力してください";

    return;
  }

  const editingId =
    editingScheduleId.value;

  const isEditing =
    Boolean(editingId);

  addScheduleButton.disabled = true;

  addScheduleButton.textContent =
    isEditing
      ? "更新中..."
      : "登録中...";

  const record = {
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

  try {
    let url =
      `${SUPABASE_URL}/rest/v1/schedules`;

    let method = "POST";

    if (isEditing) {
      url += `?id=eq.${editingId}`;
      method = "PATCH";
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
            JSON.stringify(record)
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

    scheduleMessage.textContent =
      isEditing
        ? "予定を更新しました"
        : "予定を登録しました";

    resetScheduleForm();

    await loadAdminSchedules();

  } catch (error) {
    console.error(error);

    scheduleMessage.textContent =
      error.message;

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
   予定入力フォームを初期状態へ戻す
========================================= */

function resetScheduleForm() {
  editingScheduleId.value = "";

  scheduleDate.value = "";
  scheduleStartTime.value = "";
  scheduleTitle.value = "";
  scheduleDetails.value = "";

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
   予定一覧読込
========================================= */

async function loadAdminSchedules() {
  adminScheduleList.innerHTML =
    '<p class="schedule-empty-message">' +
    '予定を読み込み中...' +
    '</p>';

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
        "予定の読込に失敗しました"
      );
    }

    const schedules =
      await response.json();

    renderAdminSchedules(
      schedules
    );

  } catch (error) {
    console.error(error);

    adminScheduleList.innerHTML =
      `<p class="schedule-empty-message">` +
      `${escapeHtml(error.message)}` +
      `</p>`;
  }
}

/* =========================================
   予定一覧表示
========================================= */

function renderAdminSchedules(
  schedules
) {
  adminScheduleList.innerHTML = "";

  if (schedules.length === 0) {
    adminScheduleList.innerHTML =
      '<p class="schedule-empty-message">' +
      '登録済みの予定はありません' +
      '</p>';

    return;
  }

  schedules.forEach(schedule => {
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

    item.innerHTML = `
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

    item
      .querySelector(
        ".edit-schedule-button"
      )
      .addEventListener(
        "click",
        () => {
          startScheduleEdit(
            schedule
          );
        }
      );

    item
      .querySelector(
        ".delete-schedule-button"
      )
      .addEventListener(
        "click",
        () => {
          deleteSchedule(
            schedule
          );
        }
      );

    adminScheduleList.appendChild(
      item
    );
  });
}


/* =========================================
   予定編集開始
========================================= */

function startScheduleEdit(
  schedule
) {
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

  scheduleMessage.textContent = "";

  window.scrollTo({
    top:
      scheduleFormTitle
        .getBoundingClientRect()
        .top +
      window.scrollY -
      20,

    behavior: "smooth"
  });
}


/* =========================================
   予定削除
========================================= */

async function deleteSchedule(
  schedule
) {
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

    scheduleMessage.textContent =
      "予定を削除しました";

    if (
      String(editingScheduleId.value) ===
      String(schedule.id)
    ) {
      resetScheduleForm();
    }

    await loadAdminSchedules();

  } catch (error) {
    console.error(error);

    scheduleMessage.textContent =
      error.message;
  }
}


/* =========================================
   イベント設定
========================================= */

addScheduleButton.addEventListener(
  "click",
  addSchedule
);

cancelScheduleEditButton.addEventListener(
  "click",
  () => {
    resetScheduleForm();

    scheduleMessage.textContent = "";
  }
);


/* =========================================
   初期読込
========================================= */

if (checkAdminAccess()) {
  loadAdminSchedules();
}