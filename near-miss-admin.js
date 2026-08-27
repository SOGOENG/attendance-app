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
  const user =
    getLoginUser();

  if (!user) {
    window.location.href =
      "login.html";

    return null;
  }

  if (
  !user.adminScope ||
  user.adminScope === "none" ||
  user.adminScope === "tool_admin"
) {
  
    alert(
      "ヒヤリハット管理を開く権限がありません"
    );

    window.location.href =
      "home.html";

    return null;
  }

  return user;
}


/* =========================================
   Supabase接続設定
========================================= */

const SUPABASE_URL =
  "https://fgmvmbjnoyagnpygcbky.supabase.co";



/* =========================================
   HTML要素
========================================= */

const monthInput =
  document.getElementById(
    "nearMissAdminMonth"
  );

const departmentSelect =
  document.getElementById(
    "nearMissAdminDepartment"
  );

const reloadButton =
  document.getElementById(
    "nearMissAdminReload"
  );

const exportCsvButton =
  document.getElementById(
    "nearMissAdminExportCsv"
  );

const messageBox =
  document.getElementById(
    "nearMissAdminMessage"
  );

const summaryElement =
  document.getElementById(
    "nearMissAdminSummary"
  );

const listElement =
  document.getElementById(
    "nearMissAdminList"
  );

const listSection =
  document.getElementById(
    "nearMissAdminListSection"
  );

const detailSection =
  document.getElementById(
    "nearMissAdminDetailSection"
  );

const closeDetailButton =
  document.getElementById(
    "nearMissAdminCloseDetail"
  );

const detailMeta =
  document.getElementById(
    "nearMissAdminDetailMeta"
  );

const detailDepartment =
  document.getElementById(
    "nearMissDetailDepartment"
  );

const detailEmployeeName =
  document.getElementById(
    "nearMissDetailEmployeeName"
  );

const detailTargetMonth =
  document.getElementById(
    "nearMissDetailTargetMonth"
  );

const detailSubmittedAt =
  document.getElementById(
    "nearMissDetailSubmittedAt"
  );

const detailSiteName =
  document.getElementById(
    "nearMissDetailSiteName"
  );

const detailClientName =
  document.getElementById(
    "nearMissDetailClientName"
  );

const detailOccurredDate =
  document.getElementById(
    "nearMissDetailOccurredDate"
  );

const detailOccurredTime =
  document.getElementById(
    "nearMissDetailOccurredTime"
  );

const detailWeather =
  document.getElementById(
    "nearMissDetailWeather"
  );

const detailWorkType =
  document.getElementById(
    "nearMissDetailWorkType"
  );

const detailPlaceType =
  document.getElementById(
    "nearMissDetailPlaceType"
  );

const detailActionType =
  document.getElementById(
    "nearMissDetailActionType"
  );

const detailStateType =
  document.getElementById(
    "nearMissDetailStateType"
  );

const detailMeasureType =
  document.getElementById(
    "nearMissDetailMeasureType"
  );

const detailReflection =
  document.getElementById(
    "nearMissDetailReflection"
  );

const loadingOverlay =
  document.getElementById(
    "nearMissAdminLoadingOverlay"
  );

const loadingMessage =
  document.getElementById(
    "nearMissAdminLoadingMessage"
  );


/* =========================================
   読み込みデータ
========================================= */

let loginUser = null;

let nearMissRecords = [];

let selectedRecord = null;


/* =========================================
   HTML表示用文字変換
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
   読み込み中表示
========================================= */

function showLoading(
  message = "読み込み中..."
) {
  if (!loadingOverlay) {
    return;
  }

  if (loadingMessage) {
    loadingMessage.textContent =
      message;
  }

  loadingOverlay.classList.remove(
    "hidden"
  );
}


function hideLoading() {
  if (!loadingOverlay) {
    return;
  }

  loadingOverlay.classList.add(
    "hidden"
  );
}


/* =========================================
   メッセージ表示
========================================= */

function showMessage(
  message,
  type = "info"
) {
  messageBox.textContent =
    message;

  messageBox.className =
    `near-miss-admin-message ${type}`;
}


function hideMessage() {
  messageBox.textContent = "";

  messageBox.className =
    "near-miss-admin-message hidden";
}


/* =========================================
   対象月変換
========================================= */

function monthValueToDate(
  monthValue
) {
  if (!monthValue) {
    return "";
  }

  return `${monthValue}-01`;
}


/*
  1日～20日：
  当月20日提出分

  21日～月末：
  翌月20日提出分
*/
function getCurrentTargetMonthValue() {
  const today =
    new Date();

  let year =
    today.getFullYear();

  let month =
    today.getMonth();

  if (today.getDate() >= 21) {
    month += 1;

    if (month >= 12) {
      year += 1;
      month = 0;
    }
  }

  return (
    `${year}-` +
    `${String(month + 1).padStart(2, "0")}`
  );
}


function formatTargetMonth(
  dateText
) {
  if (!dateText) {
    return "-";
  }

  const date =
    new Date(
      `${dateText}T00:00:00`
    );

  return (
    `${date.getMonth() + 1}/20提出`
  );
}


function formatJapaneseDate(
  dateText
) {
  if (!dateText) {
    return "-";
  }

  const date =
    new Date(
      `${dateText}T00:00:00`
    );

  return (
    `${date.getFullYear()}年` +
    `${date.getMonth() + 1}月` +
    `${date.getDate()}日`
  );
}


function formatDateTime(
  dateText
) {
  if (!dateText) {
    return "-";
  }

  const date =
    new Date(dateText);

  return (
    `${date.getFullYear()}/` +
    `${String(date.getMonth() + 1).padStart(2, "0")}/` +
    `${String(date.getDate()).padStart(2, "0")} ` +
    `${String(date.getHours()).padStart(2, "0")}:` +
    `${String(date.getMinutes()).padStart(2, "0")}`
  );
}


function formatTime(
  timeText
) {
  if (!timeText) {
    return "-";
  }

  return timeText.slice(0, 5);
}


/* =========================================
   補足付き表示
========================================= */

function combineMainAndDetail(
  mainValue,
  detailValue
) {
  const main =
    mainValue || "";

  const detail =
    detailValue || "";

  if (!main && !detail) {
    return "-";
  }

  if (!detail) {
    return main;
  }

  if (main === "その他") {
    return detail;
  }

  if (main.includes("（　）")) {
    return main.replace(
      "（　）",
      `（${detail}）`
    );
  }

  return `${main}（${detail}）`;
}


/* =========================================
   部署プルダウン作成
========================================= */

async function loadDepartmentOptions() {
  let url =
    `${SUPABASE_URL}/rest/v1/employees` +
    `?select=department` +
    `&active=eq.true` +
    `&order=department.asc`;

  if (
    loginUser.adminScope !== "all"
  ) {
    url +=
      `&department=eq.${encodeURIComponent(
        loginUser.adminScope
      )}`;
  }

  const response =
    await portalFetch(url);

  if (!response.ok) {
    const errorText =
      await response.text();

    console.error(errorText);

    throw new Error(
      "部署一覧を読み込めませんでした"
    );
  }

  const employees =
    await response.json();

  const departments = [
    ...new Set(
      employees
        .map(employee =>
          employee.department
        )
        .filter(Boolean)
    )
  ];

  departmentSelect.innerHTML = "";

  if (
    loginUser.adminScope === "all"
  ) {
    const allOption =
      document.createElement(
        "option"
      );

    allOption.value = "";

    allOption.textContent =
      "全部署";

    departmentSelect.appendChild(
      allOption
    );
  }

  departments.forEach(
    department => {
      const option =
        document.createElement(
          "option"
        );

      option.value =
        department;

      option.textContent =
        department;

      departmentSelect.appendChild(
        option
      );
    }
  );

  if (
    loginUser.adminScope !== "all"
  ) {
    departmentSelect.value =
      loginUser.adminScope;

    departmentSelect.disabled =
      true;
  }
}


/* =========================================
   選択月のデータ取得
========================================= */

async function loadNearMissRecords() {
  nearMissRecords = [];

  const targetMonth =
    monthValueToDate(
      monthInput.value
    );

  if (!targetMonth) {
    throw new Error(
      "対象月を選択してください"
    );
  }

  let url =
    `${SUPABASE_URL}/rest/v1/near_misses` +
    `?select=*` +
    `&target_month=eq.${targetMonth}` +
    `&status=eq.submitted` +
    `&order=submitted_at.desc`;

  const selectedDepartment =
    departmentSelect.value;

  if (selectedDepartment) {
    url +=
      `&department=eq.${encodeURIComponent(
        selectedDepartment
      )}`;
  }

  if (
    loginUser.adminScope !== "all"
  ) {
    url +=
      `&department=eq.${encodeURIComponent(
        loginUser.adminScope
      )}`;
  }

  const response =
    await portalFetch(url);

  if (!response.ok) {
    const errorText =
      await response.text();

    console.error(errorText);

    throw new Error(
      "ヒヤリハットデータを読み込めませんでした"
    );
  }

  nearMissRecords =
    await response.json();
}


/* =========================================
   提出一覧表示
========================================= */

function renderNearMissList() {
  listElement.innerHTML = "";

  const employeeCount =
    new Set(
      nearMissRecords.map(record =>
        `${record.department}|${record.employee_name}`
      )
    ).size;

  summaryElement.textContent =
    `提出件数 ${nearMissRecords.length}件` +
    `　提出者 ${employeeCount}人`;

  if (
    nearMissRecords.length === 0
  ) {
    listElement.innerHTML =
      '<p class="near-miss-admin-empty">' +
      'この対象月の提出済みデータはありません。' +
      '</p>';

    return;
  }

  nearMissRecords.forEach(
    (record, index) => {
      const row =
        document.createElement(
          "button"
        );

      row.type =
        "button";

      row.className =
        "near-miss-admin-row";

      const siteName =
        record.site_name ||
        "現場名未設定";

      const actionText =
        combineMainAndDetail(
          record.action_type,
          record.action_detail
        );

      row.innerHTML = `
        <div class="near-miss-admin-row-main">

          <p class="near-miss-admin-row-title">
            ${escapeHtml(siteName)}
          </p>

          <p class="near-miss-admin-row-sub">
            ${escapeHtml(record.department || "-")}
            ・
            ${escapeHtml(record.employee_name || "-")}
            ・
            ${escapeHtml(formatJapaneseDate(record.occurred_date))}
          </p>

          <p class="near-miss-admin-row-sub">
            ${escapeHtml(actionText)}
          </p>

        </div>

        <span class="near-miss-admin-row-count">
          ${index + 1}件目
        </span>
      `;

      row.addEventListener(
        "click",
        () => {
          showRecordDetail(
            record
          );
        }
      );

      listElement.appendChild(
        row
      );
    }
  );
}


/* =========================================
   詳細表示
========================================= */

function showRecordDetail(
  record
) {
  hideMessage();

  selectedRecord =
    record;

  detailMeta.textContent =
    `提出番号：${record.submission_number || "-"}件目`;

  detailDepartment.textContent =
    record.department || "-";

  detailEmployeeName.textContent =
    record.employee_name || "-";

  detailTargetMonth.textContent =
    formatTargetMonth(
      record.target_month
    );

  detailSubmittedAt.textContent =
    formatDateTime(
      record.submitted_at
    );

  detailSiteName.textContent =
    record.site_name || "-";

  detailClientName.textContent =
    record.client_name || "-";

  detailOccurredDate.textContent =
    formatJapaneseDate(
      record.occurred_date
    );

  detailOccurredTime.textContent =
    formatTime(
      record.occurred_time
    );

  detailWeather.textContent =
    record.weather || "-";

  detailWorkType.textContent =
    combineMainAndDetail(
      record.work_type,
      record.work_type_detail
    );

  detailPlaceType.textContent =
    combineMainAndDetail(
      record.place_type,
      record.place_detail
    );

  detailActionType.textContent =
    combineMainAndDetail(
      record.action_type,
      record.action_detail
    );

  detailStateType.textContent =
    combineMainAndDetail(
      record.state_type,
      record.state_detail
    );

  detailMeasureType.textContent =
    combineMainAndDetail(
      record.measure_type,
      record.measure_detail
    );

  detailReflection.textContent =
    record.reflection || "-";

  detailSection.classList.remove(
    "hidden"
  );

  detailSection.scrollIntoView({
    behavior:
      "smooth",

    block:
      "start"
  });
}


/* =========================================
   詳細を閉じる
========================================= */

function closeDetail() {
  selectedRecord = null;

  detailSection.classList.add(
    "hidden"
  );

  listSection.scrollIntoView({
    behavior:
      "smooth",

    block:
      "start"
  });
}


/* =========================================
   CSV用文字変換
========================================= */

function escapeCsv(value) {
  const text =
    String(value ?? "")
      .replaceAll(
        '"',
        '""'
      );

  return `"${text}"`;
}


/* =========================================
   CSVダウンロード
========================================= */

function downloadCsv(
  rows,
  fileName
) {
  const csvText =
    "\ufeff" +
    rows
      .map(row =>
        row
          .map(escapeCsv)
          .join(",")
      )
      .join("\n");

  const blob =
    new Blob(
      [csvText],
      {
        type:
          "text/csv;charset=utf-8"
      }
    );

  const url =
    URL.createObjectURL(
      blob
    );

  const link =
    document.createElement(
      "a"
    );

  link.href =
    url;

  link.download =
    fileName;

  document.body.appendChild(
    link
  );

  link.click();

  link.remove();

  URL.revokeObjectURL(
    url
  );
}


/* =========================================
   Googleスプレッドシート用CSV
========================================= */

function exportNearMissCsv() {
  hideMessage();

  if (!monthInput.value) {
    showMessage(
      "対象月を選択してください",
      "error"
    );

    return;
  }

  if (
    nearMissRecords.length === 0
  ) {
    showMessage(
      "提出済みのヒヤリハットがありません",
      "error"
    );

    return;
  }

  const csvRows = [];

  /*
    現在のGoogleフォーム回答と
    同じ15列の並び
  */
  csvRows.push([
    "タイムスタンプ",
    "提出月",
    "氏名",
    "現場名",
    "元請",
    "日付",
    "時刻",
    "天気",
    "作業の種別",
    "場所・物",
    "どうしたか",
    "（　）付を選択の場合",
    "状態",
    "対策",
    "対策・反省点等"
  ]);

  nearMissRecords.forEach(
    record => {
      const workType =
        record.work_type === "その他"
          ? record.work_type_detail
          : record.work_type;

      const placeType =
        record.place_type === "その他"
          ? record.place_detail
          : record.place_type;

      const actionType =
        record.action_type === "その他"
          ? record.action_detail
          : record.action_type;

      const stateType =
        record.state_type === "その他"
          ? record.state_detail
          : record.state_type;

      const measureType =
        record.measure_type === "その他"
          ? record.measure_detail
          : record.measure_type;

      csvRows.push([
        formatDateTime(
          record.submitted_at
        ),

        formatTargetMonth(
          record.target_month
        ),

        record.employee_name || "",

        record.site_name || "",

        record.client_name || "",

        record.occurred_date || "",

        formatTime(
          record.occurred_time
        ),

        record.weather || "",

        workType || "",

        placeType || "",

        actionType || "",

        record.action_type &&
        record.action_type.includes("（　）")
          ? record.action_detail || ""
          : "",

        stateType || "",

        measureType || "",

        record.reflection || ""
      ]);
    }
  );

  downloadCsv(
    csvRows,
    `ヒヤリハット_${monthInput.value}.csv`
  );

  showMessage(
    "提出済みデータをCSV出力しました。",
    "success"
  );
}


/* =========================================
   管理画面読込
========================================= */

async function loadAdminScreen() {
  hideMessage();

  detailSection.classList.add(
    "hidden"
  );

  listElement.innerHTML =
    '<p class="near-miss-admin-empty">' +
    '読み込み中...' +
    '</p>';

  summaryElement.textContent =
    "読み込み中...";

  reloadButton.disabled =
    true;

  exportCsvButton.disabled =
    true;

  reloadButton.textContent =
    "読込中...";

  try {
    showLoading(
      "ヒヤリハットを読み込んでいます..."
    );

    await loadNearMissRecords();

    renderNearMissList();

  } catch (error) {
    console.error(error);

    listElement.innerHTML =
      '<p class="near-miss-admin-empty">' +
      `${escapeHtml(error.message)}` +
      '</p>';

    summaryElement.textContent =
      "読込失敗";

    showMessage(
      error.message,
      "error"
    );

  } finally {
    reloadButton.disabled =
      false;

    exportCsvButton.disabled =
      false;

    reloadButton.textContent =
      "更新";

    hideLoading();
  }
}


/* =========================================
   初期表示
========================================= */

async function initializePage() {
  loginUser =
    checkAdminAccess();

  if (!loginUser) {
    return;
  }

  monthInput.value =
    getCurrentTargetMonthValue();

  try {
    showLoading(
      "管理画面を準備しています..."
    );

    await loadDepartmentOptions();

    await loadAdminScreen();

  } catch (error) {
    console.error(error);

    showMessage(
      error.message,
      "error"
    );

  } finally {
    hideLoading();
  }
}


/* =========================================
   イベント設定
========================================= */

reloadButton.addEventListener(
  "click",
  loadAdminScreen
);

monthInput.addEventListener(
  "change",
  loadAdminScreen
);

departmentSelect.addEventListener(
  "change",
  loadAdminScreen
);

exportCsvButton.addEventListener(
  "click",
  exportNearMissCsv
);

closeDetailButton.addEventListener(
  "click",
  closeDetail
);


/* =========================================
   実行
========================================= */

initializePage();