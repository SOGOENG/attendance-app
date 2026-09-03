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

  /*
    ログインしていない場合
  */

  if (!loginUser) {
    window.location.href =
      "login.html";

    return false;
  }

  /*
    管理権限がない場合
  */

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

const month =
  document.getElementById("month");

const attendanceList =
  document.getElementById("attendanceList");

const submissionSummary =
  document.getElementById("submissionSummary");

const statusSection =
  document.getElementById("statusSection");

const detailSection =
  document.getElementById("detailSection");

const detailEmployeeName =
  document.getElementById("detailEmployeeName");

const detailStatus =
  document.getElementById("detailStatus");

const attendanceDetail =
  document.getElementById("attendanceDetail");

const reloadButton =
  document.getElementById("reload");

const exportAllCsvButton =
  document.getElementById("exportAllCsv");

const resetAllAttendanceButton =
  document.getElementById(
    "resetAllAttendance"
  );  

const closeDetailButton =
  document.getElementById("closeDetail");
  

/* =========================================
   読み込んだデータ
========================================= */

let employees = [];
let sites = [];
let monthlyAttendance = [];


/* =========================================
   現在の年月
========================================= */

function currentMonth() {
  const date = new Date();

  const year =
    date.getFullYear();

  const monthValue =
    String(date.getMonth() + 1)
      .padStart(2, "0");

  return `${year}-${monthValue}`;
}


/* =========================================
   翌月1日を取得
========================================= */

/* =========================================
   締め日設定
========================================= */

const CLOSING_DAY = 20;


/* =========================================
   日付をYYYY-MM-DD形式へ変換
========================================= */

function formatDateValue(date) {

  const year =
    date.getFullYear();

  const month =
    String(
      date.getMonth() + 1
    ).padStart(2, "0");

  const day =
    String(
      date.getDate()
    ).padStart(2, "0");

  return `${year}-${month}-${day}`;

}


/* =========================================
   締め期間取得
========================================= */

function getAttendanceRange(yearMonth){

  const [
    year,
    month
  ] =
    yearMonth
      .split("-")
      .map(Number);

  const startDate =
    new Date(
      year,
      month - 2,
      CLOSING_DAY + 1
    );

  const endDate =
    new Date(
      year,
      month - 1,
      CLOSING_DAY
    );

  const nextDate =
    new Date(endDate);

  nextDate.setDate(
    nextDate.getDate() + 1
  );

  return {

    firstDay:
      formatDateValue(startDate),

    nextFirstDay:
      formatDateValue(nextDate)

  };

}
  
/* =========================================
   日付を日本語表示
========================================= */

function formatDate(dateText) {
  const date =
    new Date(`${dateText}T00:00:00`);

  const weeks = [
    "日",
    "月",
    "火",
    "水",
    "木",
    "金",
    "土"
  ];

  return (
    `${date.getMonth() + 1}月` +
    `${date.getDate()}日` +
    `（${weeks[date.getDay()]}）`
  );
}


/* =========================================
   社員一覧読込
========================================= */

async function loadEmployees() {
  const url =
    `${SUPABASE_URL}/rest/v1/employees` +
    `?select=` +
    `id,name,department,active,attendance_required` +
    `&active=eq.true` +
    `&attendance_required=eq.true` +
    `&order=department.asc,id.asc`;

  const response =
    await portalFetch(url);

  if (!response.ok) {
    const errorText =
      await response.text();

    console.error(errorText);

    throw new Error(
      "社員一覧の読込に失敗しました"
    );
  }

  employees =
    await response.json();
}

/* =========================================
   現場マスタ読込
========================================= */

async function loadSites() {
  const url =
    `${SUPABASE_URL}/rest/v1/sites` +
    `?select=` +
    `id,display_name,input_code,construction_no,site_type`;

  const response =
    await portalFetch(url);

  if (!response.ok) {
    const errorText =
      await response.text();

    console.error(errorText);

    throw new Error(
      "現場マスタの読込に失敗しました"
    );
  }

  sites =
    await response.json();
}


/* =========================================
   対象月の全出勤簿読込
========================================= */

async function loadMonthlyAttendance() {
  if (!month.value) {
    monthlyAttendance = [];

    return;
  }

  const range =
    getAttendanceRange(
      month.value
    );

  const url =
    `${SUPABASE_URL}/rest/v1/attendance` +
    `?select=*` +
    `&work_date=gte.${range.firstDay}` +
    `&work_date=lt.${range.nextFirstDay}` +
    `&order=employee_id.asc,work_date.asc`;

  const response =
    await portalFetch(url);

  if (!response.ok) {
    const errorText =
      await response.text();

    console.error(errorText);

    throw new Error(
      "出勤簿の読込に失敗しました"
    );
  }

  monthlyAttendance =
    await response.json();
}


/* =========================================
   社員情報取得
========================================= */

function getEmployee(employeeId) {
  return employees.find(
    item =>
      Number(item.id) ===
      Number(employeeId)
  ) || null;
}


/* =========================================
   社員の月間データ取得
========================================= */

function getEmployeeAttendance(employeeId) {
  return monthlyAttendance.filter(
    item =>
      Number(item.employee_id) ===
      Number(employeeId)
  );
}


/* =========================================
   社員の提出状態取得
========================================= */

function getEmployeeStatus(employeeId) {
  const employeeAttendance =
    getEmployeeAttendance(employeeId);

  if (employeeAttendance.length === 0) {
    return "not_saved";
  }

  const hasLocked =
    employeeAttendance.some(
      item => item.status === "locked"
    );

  if (hasLocked) {
    return "locked";
  }

  const hasSubmitted =
    employeeAttendance.some(
      item => item.status === "submitted"
    );

  if (hasSubmitted) {
    return "submitted";
  }

  return "draft";
}


/* =========================================
   状態表示情報
========================================= */

function statusInfo(status) {
  if (status === "locked") {
    return {
      icon: "🔒",
      text: "締切済",
      csvText: "締切済",
      className: "status-locked"
    };
  }

  if (status === "submitted") {
    return {
      icon: "🟢",
      text: "提出済",
      csvText: "提出済",
      className: "status-submitted"
    };
  }

  if (status === "draft") {
    return {
      icon: "🟡",
      text: "一時保存",
      csvText: "一時保存",
      className: "status-draft"
    };
  }

  return {
    icon: "⚪",
    text: "未保存",
    csvText: "未保存",
    className: "status-not-saved"
  };
}


/* =========================================
   部ごとの提出人数取得
========================================= */

function getDepartmentSubmissionCount(
  departmentName
) {
  const departmentEmployees =
    employees.filter(
      employee =>
        employee.department ===
        departmentName
    );

  const submittedCount =
    departmentEmployees.filter(
      employee => {
        const status =
          getEmployeeStatus(employee.id);

        return (
          status === "submitted" ||
          status === "locked"
        );
      }
    ).length;

  return {
    submitted:
      submittedCount,

    total:
      departmentEmployees.length
  };
}


/* =========================================
   提出状況一覧表示
========================================= */

function renderAttendanceStatus() {
  attendanceList.innerHTML = "";

  let currentDepartment = "";
  let submittedCount = 0;

  employees.forEach(employee => {
    const status =
      getEmployeeStatus(employee.id);

    const info =
      statusInfo(status);

    if (
      status === "submitted" ||
      status === "locked"
    ) {
      submittedCount++;
    }

    if (
      employee.department !==
      currentDepartment
    ) {
      currentDepartment =
        employee.department;

      const count =
        getDepartmentSubmissionCount(
          currentDepartment
        );

      const departmentTitle =
        document.createElement("h3");

      departmentTitle.className =
        "admin-department-title";

      departmentTitle.textContent =
        `${currentDepartment}（` +
        `${count.submitted} / ${count.total}人）`;

      attendanceList.appendChild(
        departmentTitle
      );
    }

    const button =
      document.createElement("button");

    button.type = "button";

    button.className =
      `employee-row ` +
      `employee-status-button ` +
      `${info.className}`;

    button.innerHTML = `
      <span class="employee-status-icon">
        ${info.icon}
      </span>

      <span class="employee-status-name">
        ${escapeHtml(employee.name)}
      </span>

      <span class="employee-status-text">
        ${info.text}
      </span>
    `;

    button.addEventListener(
      "click",
      () => {
        showEmployeeDetail(employee);
      }
    );

    attendanceList.appendChild(button);
  });

  submissionSummary.textContent =
    `${submittedCount} / ${employees.length}人`;
}


/* =========================================
   現場情報取得
========================================= */

function getSite(siteId) {
  if (!siteId) {
    return null;
  }

  return sites.find(
    item =>
      Number(item.id) ===
      Number(siteId)
  ) || null;
}


/* =========================================
   一般現場名取得
========================================= */

function getSiteName(siteId) {
  const site =
    getSite(siteId);

  if (!site) {
    return "";
  }

  return site.display_name || "";
}


/* =========================================
   CSV用現場コード取得
========================================= */

function getConstructionNo(siteId) {
  const site =
    getSite(siteId);

  if (!site) {
    return "";
  }

  return site.construction_no || "";
}

/* =========================================
   表示用現場名作成
========================================= */

function makeDisplaySiteName(item) {

    /*
    会社勤務
  */

  if (item.site_type === "会社勤務") {
    return (
      item.company_work ||
      "勤務内容未選択"
    );
  }

  /*
    一般現場
  */

  if (item.site_type === "一般") {
    return (
      getSiteName(item.site_id) ||
      "一般現場未選択"
    );
  }


  /*
    雑工事
  */

  if (item.site_type === "雑工事") {
    const parts = [];

    if (item.misc_company) {
      parts.push(item.misc_company);
    }

    if (item.misc_department) {
      parts.push(item.misc_department);
    }

    if (item.misc_name) {
      parts.push(item.misc_name);
    }

    return (
      parts.join("／") ||
      "雑工事詳細未入力"
    );
  }


  /*
    休み
  */

  if (item.site_type === "休み") {
    return (
      item.leave_type ||
      "休暇区分未選択"
    );
  }


  return "";
}

/* =========================================
   入力のある日か判定
========================================= */

function hasAttendanceInput(item) {
  return Boolean(
    item.site_type ||
    item.site_id ||
    item.misc_company ||
    item.misc_department ||
    item.misc_name ||
     item.leave_type ||
    item.start_time ||
    item.end_time ||
    item.note
  );
}

function applicationApprovalNote(item) {
  if (item?.source_application_id == null) return item?.note || "";
  if (item.leave_type === "有給") return "申請承認済み（有給）";
  if (item.leave_type === "代休") return "申請承認済み（代休）";
  return "申請承認済み";
}


/* =========================================
   社員詳細表示
========================================= */

function showEmployeeDetail(employee) {
  const employeeAttendance =
    getEmployeeAttendance(employee.id);

  const status =
    getEmployeeStatus(employee.id);

  const info =
    statusInfo(status);

  detailEmployeeName.textContent =
    `${employee.name}　${month.value}`;

  detailStatus.textContent =
    `${info.icon} ${info.text}`;

  detailStatus.className =
    `admin-detail-status ` +
    `${info.className}`;

  attendanceDetail.innerHTML = "";

  const inputDays =
    employeeAttendance.filter(
      hasAttendanceInput
    );

  if (inputDays.length === 0) {
    attendanceDetail.innerHTML =
      '<p class="empty-message">' +
      '入力データはありません。' +
      '</p>';

    detailSection.classList.remove(
      "hidden"
    );

    detailSection.scrollIntoView({
      behavior: "smooth",
      block: "start"
    });

    return;
  }

  inputDays.forEach(item => {
    const siteName =
      makeDisplaySiteName(item);

    const timeText =
      item.start_time || item.end_time
        ? `${item.start_time || "未入力"} ～ ` +
          `${item.end_time || "未入力"}`
        : "時刻未入力";

    const card =
      document.createElement("div");

    card.className =
      "attendance-detail-row";

    const displayNote = applicationApprovalNote(item);

    card.innerHTML = `
      <div class="attendance-detail-date">
        ${escapeHtml(formatDate(item.work_date))}
      </div>

      <div class="attendance-detail-content">

        <div>
          <strong>現場：</strong>
          ${escapeHtml(siteName || "未入力")}
        </div>

        <div>
          <strong>時間：</strong>
          ${escapeHtml(timeText)}
        </div>

        ${
          displayNote
            ? `
              <div class="${item.source_application_id != null ? "attendance-application-note" : ""}">
                <strong>備考：</strong>
                ${escapeHtml(displayNote)}
              </div>
            `
            : ""
        }

      </div>
    `;

    attendanceDetail.appendChild(card);
  });

  detailSection.classList.remove(
    "hidden"
  );

  detailSection.scrollIntoView({
    behavior: "smooth",
    block: "start"
  });
}


/* =========================================
   詳細を閉じる
========================================= */

function closeEmployeeDetail() {
  detailSection.classList.add(
    "hidden"
  );

  attendanceDetail.innerHTML = "";

  statusSection.scrollIntoView({
    behavior: "smooth",
    block: "start"
  });
}


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
   CSV用文字エスケープ
========================================= */

function escapeCsv(value) {
  const text =
    String(value ?? "")
      .replaceAll('"', '""');

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
    URL.createObjectURL(blob);

  const link =
    document.createElement("a");

  link.href = url;
  link.download = fileName;

  document.body.appendChild(link);

  link.click();
  link.remove();

  URL.revokeObjectURL(url);
}


/* =========================================
   全員分CSV作成
========================================= */

function exportAllCsv() {
  if (!month.value) {
    alert(
      "対象月を選択してください"
    );

    return;
  }

  if (monthlyAttendance.length === 0) {
    alert(
      "対象月の出勤簿データがありません"
    );

    return;
  }

  const csvRows = [];

  /*
    CSVの見出し
  */

  csvRows.push([
    "部",
    "氏名",
    "対象月",
    "日付",
    "区分",
    "工事番号",
    "現場名",
    "勤務内容",
    "休暇区分",
    "雑工事区分",
    "担当部",
    "雑工事名",
    "開始",
    "終了",
    "備考",
    "提出状態"
  ]);

  monthlyAttendance.forEach(item => {
    const employee =
      getEmployee(item.employee_id);

    if (!employee) {
      return;
    }

    const employeeStatus =
      getEmployeeStatus(employee.id);

    const status =
      statusInfo(employeeStatus);

    let siteCode = "";
    let siteName = "";

    /*
      一般現場
    */

    if (item.site_type === "一般") {
      siteCode =
        getConstructionNo(item.site_id);

      siteName =
        getSiteName(item.site_id);
    }

    /*
      雑工事
    */

    if (item.site_type === "雑工事") {
      siteCode =
        getConstructionNo(item.site_id);

      siteName =
        makeDisplaySiteName(item);
    }

    /*
      会社勤務
    */

    if (item.site_type === "会社勤務") {
      siteName =
        item.company_work || "";
    }

    /*
      休み
    */

    if (item.site_type === "休み") {
      siteName =
        item.leave_type || "";
    }

    /*
      1日分をCSVへ追加
    */

    csvRows.push([
      employee.department || "",
      employee.name || "",
      month.value,
      item.work_date || "",
      item.site_type || "",
      siteCode,
      siteName,
      item.company_work || "",
      item.leave_type || "",
      item.misc_company || "",
      item.misc_department || "",
      item.misc_name || "",
      item.start_time || "",
      item.end_time || "",
      item.note || "",
      status.csvText
    ]);
  });

  downloadCsv(
    csvRows,
    `出勤簿_全員_${month.value}.csv`
  );
}

/* =========================================
   対象月の全員分出勤簿リセット
========================================= */

async function resetAllAttendance() {
  if (!month.value) {
    alert(
      "対象月を選択してください"
    );

    return;
  }

  const range =
    getAttendanceRange(
      month.value
    );

  const firstConfirmed =
    window.confirm(
      `${month.value}の出勤簿データを` +
      `全員分削除します。\n\n` +
      `この操作は元に戻せません。\n` +
      `本当にリセットしますか？`
    );

  if (!firstConfirmed) {
    return;
  }

  const resetText =
    window.prompt(
      "最終確認です。\n\n" +
      "削除する場合は、半角英字で\n" +
      "RESET\n" +
      "と入力してください。"
    );

  if (resetText !== "RESET") {
    alert(
      "入力が違うため、リセットを中止しました"
    );

    return;
  }

  resetAllAttendanceButton.disabled =
    true;

  resetAllAttendanceButton.textContent =
    "リセット中...";

  try {
    const url =
      `${SUPABASE_URL}/rest/v1/attendance` +
      `?work_date=gte.${range.firstDay}` +
      `&work_date=lt.${range.nextFirstDay}` +
      `&source_application_id=is.null`;

    const response =
      await portalFetch(
        url,
        {
          method:
            "DELETE",

          headers: {
            Prefer:
              "return=representation"
          }
        }
      );

    if (!response.ok) {
      const errorText =
        await response.text();

      console.error(errorText);

      throw new Error(
        "出勤簿データをリセットできませんでした"
      );
    }

    const deletedRows =
      await response.json();

    alert(
      `${month.value}の出勤簿を` +
      `${deletedRows.length}件削除しました`
    );

    await loadAdminScreen();

  } catch (error) {
    console.error(error);

    alert(
      error.message
    );

  } finally {
    resetAllAttendanceButton.disabled =
      false;

    resetAllAttendanceButton.textContent =
      "対象月の出勤簿を全員分リセット";
  }
}


/* =========================================
   管理画面全体読込
========================================= */

async function loadAdminScreen() {
  attendanceList.innerHTML =
    "読込中...";

  submissionSummary.textContent =
    "読込中...";

  detailSection.classList.add(
    "hidden"
  );

  reloadButton.disabled = true;
  exportAllCsvButton.disabled = true;

  reloadButton.textContent =
    "読込中…";

  try {
    await Promise.all([
      loadEmployees(),
      loadSites(),
      loadMonthlyAttendance()
    ]);

    renderAttendanceStatus();

  } catch (error) {
    console.error(error);

    attendanceList.innerHTML =
      `<p class="error-message">` +
      `${escapeHtml(error.message)}` +
      `</p>`;

    submissionSummary.textContent =
      "読込失敗";

  } finally {
    reloadButton.disabled = false;
    exportAllCsvButton.disabled = false;

    reloadButton.textContent =
      "更新";
  }
}


/* =========================================
   イベント設定
========================================= */

month.value =
  currentMonth();


reloadButton.addEventListener(
  "click",
  loadAdminScreen
);


month.addEventListener(
  "change",
  loadAdminScreen
);


closeDetailButton.addEventListener(
  "click",
  closeEmployeeDetail
);

exportAllCsvButton.addEventListener(
  "click",
  exportAllCsv
);

resetAllAttendanceButton.addEventListener(
  "click",
  resetAllAttendance
);


/* =========================================
   初期読込
========================================= */

if (checkAdminAccess()) {
  loadAdminScreen();
}

