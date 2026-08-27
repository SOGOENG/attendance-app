const SUPABASE_URL =
  "https://fgmvmbjnoyagnpygcbky.supabase.co";

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
      "向上提案管理を開く権限がありません"
    );

    window.location.href =
      "home.html";

    return null;
  }

  return user;
}



/* =========================================
   HTML要素
========================================= */

const monthInput =
  document.getElementById(
    "improvementAdminMonth"
  );

const reloadButton =
  document.getElementById(
    "improvementAdminReload"
  );

const exportCsvButton =
  document.getElementById(
    "improvementAdminExportCsv"
  );

const themeSettingInput =
  document.getElementById(
    "improvementAdminThemeSetting"
  );

const saveThemeButton =
  document.getElementById(
    "improvementAdminSaveTheme"
  );  

const messageBox =
  document.getElementById(
    "improvementAdminMessage"
  );

const summaryElement =
  document.getElementById(
    "improvementAdminSummary"
  );

const listElement =
  document.getElementById(
    "improvementAdminList"
  );

const listSection =
  document.getElementById(
    "improvementAdminListSection"
  );

const detailSection =
  document.getElementById(
    "improvementAdminDetailSection"
  );

const employeeNameElement =
  document.getElementById(
    "improvementAdminEmployeeName"
  );

const detailStatusElement =
  document.getElementById(
    "improvementAdminDetailStatus"
  );

const monthlyThemeElement =
  document.getElementById(
    "improvementAdminMonthlyTheme"
  );

const recordIdInput =
  document.getElementById(
    "improvementAdminRecordId"
  );

const monthlyAnswerInput =
  document.getElementById(
    "improvementAdminMonthlyAnswer"
  );

const theme1CategoryInput =
  document.getElementById(
    "improvementAdminTheme1Category"
  );

const theme1BodyInput =
  document.getElementById(
    "improvementAdminTheme1Body"
  );

const theme2CategoryInput =
  document.getElementById(
    "improvementAdminTheme2Category"
  );

const theme2BodyInput =
  document.getElementById(
    "improvementAdminTheme2Body"
  );

const theme3CategoryInput =
  document.getElementById(
    "improvementAdminTheme3Category"
  );

const theme3BodyInput =
  document.getElementById(
    "improvementAdminTheme3Body"
  );

const editForm =
  document.getElementById(
    "improvementAdminEditForm"
  );

const saveChangesButton =
  document.getElementById(
    "improvementAdminSaveChanges"
  );

const returnDraftButton =
  document.getElementById(
    "improvementAdminReturnDraft"
  );

const closeDetailButton =
  document.getElementById(
    "improvementAdminCloseDetail"
  );


/* =========================================
   読み込みデータ
========================================= */

let loginUser = null;

let employees = [];

let improvements = [];

let currentSetting = null;

let selectedRecord = null;


/* =========================================
   向上提案の分類一覧
========================================= */

const improvementCategories = [
  "向上（個人・会社・受注）",
  "VE提案・コストダウン提案",
  "エコ活動（環境整備・節約）",
  "健康管理",
  "安全管理・安全作業",
  "交通安全・安全運転",
  "技術・技能・工法・効率",
  "現場状況報告",
  "現場管理・施工管理・原価削減",
  "段取りと効率・作業計画",
  "加工工場・プレハブ加工・倉庫管理・運搬",
  "品質管理・品質向上",
  "スリーブ・インサート・管支持・消耗品・工具",
  "営業・受注活動",
  "業務・効率",
  "トラブル・クレーム・予防対策・失敗・反省",
  "何でも提案・出来事",
  "気になるニュース",
  "趣味",
  "前回分最優秀提案の推薦"
];


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
   メッセージ表示
========================================= */

function showMessage(
  message,
  type = "info"
) {
  messageBox.textContent =
    message;

  messageBox.className =
    `improvement-admin-message ${type}`;
}


function hideMessage() {
  messageBox.textContent = "";

  messageBox.className =
    "improvement-admin-message hidden";
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


function dateToMonthValue(
  dateText
) {
  if (!dateText) {
    return "";
  }

  return dateText.slice(0, 7);
}


/* =========================================
   分類プルダウン作成
========================================= */

function createCategoryOptions() {
  const selectElements = [
    theme1CategoryInput,
    theme2CategoryInput,
    theme3CategoryInput
  ];

  selectElements.forEach(
    selectElement => {

      selectElement.innerHTML = "";

      const emptyOption =
        document.createElement(
          "option"
        );

      emptyOption.value = "";

      emptyOption.textContent =
        "選択してください";

      selectElement.appendChild(
        emptyOption
      );

      improvementCategories.forEach(
        category => {

          const option =
            document.createElement(
              "option"
            );

          option.value =
            category;

          option.textContent =
            category;

          selectElement.appendChild(
            option
          );
        }
      );
    }
  );
}


/* =========================================
   最新の公開設定取得
========================================= */

async function loadLatestPublishedSetting() {
  const url =
    `${SUPABASE_URL}/rest/v1/improvement_settings` +
    `?select=*` +
    `&is_published=eq.true` +
    `&order=target_month.desc` +
    `&limit=1`;

  const response =
    await portalFetch(url);

  if (!response.ok) {
    const errorText =
      await response.text();

    console.error(errorText);

    throw new Error(
      "公開中の対象月を読み込めませんでした"
    );
  }

  const settings =
    await response.json();

  if (settings.length === 0) {
    throw new Error(
      "公開中の向上提案設定がありません"
    );
  }

  monthInput.value =
    dateToMonthValue(
      settings[0].target_month
    );
}


/* =========================================
   選択月の設定取得
========================================= */

async function loadMonthlySetting() {
  currentSetting = null;

  const targetMonth =
    monthValueToDate(
      monthInput.value
    );

  themeSettingInput.value = "";

  if (!targetMonth) {
    return;
  }

  const url =
    `${SUPABASE_URL}/rest/v1/improvement_settings` +
    `?select=*` +
    `&target_month=eq.${targetMonth}` +
    `&limit=1`;

  const response =
    await portalFetch(url);

  if (!response.ok) {
    const errorText =
      await response.text();

    console.error(errorText);

    throw new Error(
      "対象月の設定を読み込めませんでした"
    );
  }

  const settings =
    await response.json();

  if (settings.length > 0) {
    currentSetting =
      settings[0];

    themeSettingInput.value =
      currentSetting.monthly_theme || "";
  }
}


/* =========================================
   今月のテーマ保存
========================================= */

async function saveMonthlyTheme() {
  hideMessage();

  const targetMonth =
    monthValueToDate(
      monthInput.value
    );

  const monthlyTheme =
    themeSettingInput.value.trim();

  if (!targetMonth) {
    showMessage(
      "対象月を選択してください",
      "error"
    );

    return;
  }

  if (!monthlyTheme) {
    showMessage(
      "今月のテーマを入力してください",
      "error"
    );

    return;
  }

  const confirmed =
    window.confirm(
      `${monthInput.value}の今月のテーマを保存しますか？`
    );

  if (!confirmed) {
    return;
  }

  saveThemeButton.disabled = true;

  saveThemeButton.textContent =
    "保存中...";

  const saveData = {
    target_month:
      targetMonth,

    monthly_theme:
      monthlyTheme,

    is_published:
      true,

    updated_at:
      new Date().toISOString()
  };

  try {
    let url =
      `${SUPABASE_URL}/rest/v1/improvement_settings`;

    let method =
      "POST";

    if (currentSetting?.id) {
      url +=
        `?id=eq.${currentSetting.id}`;

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
              "return=representation"
          },

          body:
            JSON.stringify(
              saveData
            )
        }
      );

    if (!response.ok) {
      const errorText =
        await response.text();

      console.error(errorText);

      throw new Error(
        "今月のテーマを保存できませんでした"
      );
    }

    const savedSettings =
      await response.json();

    if (savedSettings.length > 0) {
      currentSetting =
        savedSettings[0];
    }

    themeSettingInput.value =
      currentSetting?.monthly_theme ||
      monthlyTheme;

    showMessage(
      "今月のテーマを保存しました。",
      "success"
    );

  } catch (error) {
    console.error(error);

    showMessage(
      error.message,
      "error"
    );

  } finally {
    saveThemeButton.disabled =
      false;

    saveThemeButton.textContent =
      "今月のテーマを保存";
  }
}

/* =========================================
   社員一覧取得
========================================= */

async function loadEmployees() {
  let url =
    `${SUPABASE_URL}/rest/v1/employees` +
    `?select=name,department,active,improvement_required` +
    `&active=eq.true` +
    `&improvement_required=eq.true` +
    `&order=department.asc,name.asc`;

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
      "社員一覧を読み込めませんでした"
    );
  }

  employees =
    await response.json();
}

/* =========================================
   選択月の向上提案取得
========================================= */

async function loadImprovements() {
  improvements = [];

  const targetMonth =
    monthValueToDate(
      monthInput.value
    );

  if (!targetMonth) {
    return;
  }

  let url =
    `${SUPABASE_URL}/rest/v1/improvements` +
    `?select=*` +
    `&target_month=eq.${targetMonth}` +
    `&order=department.asc,employee_name.asc`;

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
      "向上提案データを読み込めませんでした"
    );
  }

  improvements =
    await response.json();
}


/* =========================================
   社員の提出データ取得
========================================= */

function getEmployeeRecord(
  employee
) {
  return improvements.find(
    item =>
      item.department ===
        employee.department &&
      item.employee_name ===
        employee.name
  ) || null;
}


/* =========================================
   状態表示
========================================= */

function statusInfo(record) {
  if (!record) {
  return {
    text:
      "未提出",

    className:
      "improvement-admin-status-not-submitted"
  };
}

  if (record.status === "submitted") {
    return {
      text:
        "提出済",

      className:
        "improvement-admin-status-submitted"
    };
  }

  return {
    text:
      "一時保存",

    className:
      "improvement-admin-status-draft"
  };
}


/* =========================================
   提出状況一覧表示
========================================= */

function renderImprovementList() {
  listElement.innerHTML = "";

  const submittedCount =
    improvements.filter(
      item =>
        item.status === "submitted"
    ).length;

  const draftCount =
    improvements.filter(
      item =>
        item.status === "draft"
    ).length;

  summaryElement.textContent =
    `提出済 ${submittedCount} / ` +
    `${employees.length}人` +
    `　（一時保存 ${draftCount}人）`;

  if (employees.length === 0) {
    listElement.innerHTML =
      '<p class="improvement-admin-empty">' +
      '表示できる社員がいません。' +
      '</p>';

    return;
  }

  let currentDepartment = "";

  employees.forEach(employee => {
    if (
      employee.department !==
      currentDepartment
    ) {
      currentDepartment =
        employee.department;

      const departmentEmployees =
        employees.filter(
          item =>
            item.department ===
            currentDepartment
        );

      const departmentSubmitted =
        departmentEmployees.filter(
          item => {
            const record =
              getEmployeeRecord(item);

            return (
              record &&
              record.status ===
                "submitted"
            );
          }
        ).length;

      const departmentTitle =
        document.createElement(
          "h3"
        );

      departmentTitle.className =
        "improvement-admin-department-title";

      departmentTitle.textContent =
        `${currentDepartment}（` +
        `${departmentSubmitted} / ` +
        `${departmentEmployees.length}人）`;

      listElement.appendChild(
        departmentTitle
      );
    }

    const record =
      getEmployeeRecord(employee);

    const info =
      statusInfo(record);

    const row =
      document.createElement(
        "button"
      );

    row.type = "button";

    row.className =
  record
    ? "improvement-admin-row"
    : "improvement-admin-row improvement-admin-row-not-submitted";

    row.innerHTML = `
      <span class="improvement-admin-row-name">
        ${escapeHtml(employee.name)}
      </span>

      <span
        class="
          improvement-admin-status
          ${info.className}
        "
      >
        ${info.text}
      </span>
    `;

    /*
      保存データがある社員だけ
      詳細画面を開ける
    */

    if (record) {
      row.addEventListener(
        "click",
        () => {
          showRecordDetail(record);
        }
      );

    } else {
      row.title =
        "向上提案はまだ提出されていません"
    }

    listElement.appendChild(row);
  });
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

  recordIdInput.value =
    record.id;

  employeeNameElement.textContent =
    `${record.department}　` +
    `${record.employee_name}`;

  const info =
    statusInfo(record);

  detailStatusElement.textContent =
    info.text;

  detailStatusElement.className =
    `improvement-admin-detail-status ` +
    `${info.className}`;

  monthlyThemeElement.textContent =
    record.monthly_theme ||
    currentSetting?.monthly_theme ||
    "今月のテーマは未設定です";

  monthlyAnswerInput.value =
    record.monthly_theme_answer || "";

  theme1CategoryInput.value =
    record.theme1_category || "";

  theme1BodyInput.value =
    record.theme1_body || "";

  theme2CategoryInput.value =
    record.theme2_category || "";

  theme2BodyInput.value =
    record.theme2_body || "";

  theme3CategoryInput.value =
    record.theme3_category || "";

  theme3BodyInput.value =
    record.theme3_body || "";

  /*
    一時保存中なら、
    再編集可能に戻す必要はない
  */

  returnDraftButton.hidden =
    record.status !== "submitted";

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

  recordIdInput.value = "";

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
   管理者修正の入力確認
========================================= */

function validateEditForm() {
  if (
    !monthlyAnswerInput.value.trim()
  ) {
    throw new Error(
      "今月のテーマの本文を入力してください"
    );
  }

  const themes = [
    {
      name:
        "テーマ①",

      category:
        theme1CategoryInput.value,

      body:
        theme1BodyInput.value.trim()
    },

    {
      name:
        "テーマ②",

      category:
        theme2CategoryInput.value,

      body:
        theme2BodyInput.value.trim()
    },

    {
      name:
        "テーマ③",

      category:
        theme3CategoryInput.value,

      body:
        theme3BodyInput.value.trim()
    }
  ];

  themes.forEach(theme => {
    if (!theme.category) {
      throw new Error(
        `${theme.name}の分類を選択してください`
      );
    }

    if (!theme.body) {
      throw new Error(
        `${theme.name}の本文を入力してください`
      );
    }
  });
}


/* =========================================
   管理者による修正保存
========================================= */

async function saveAdminChanges(
  event
) {
  event.preventDefault();

  hideMessage();

  if (!selectedRecord) {
    showMessage(
      "修正するデータが選択されていません",
      "error"
    );

    return;
  }

  try {
    validateEditForm();

  } catch (error) {
    showMessage(
      error.message,
      "error"
    );

    return;
  }

  const confirmed =
    window.confirm(
      `${selectedRecord.employee_name}さんの` +
      `向上提案を修正しますか？`
    );

  if (!confirmed) {
    return;
  }

  saveChangesButton.disabled =
    true;

  saveChangesButton.textContent =
    "保存中...";

  const updateData = {
    monthly_theme_answer:
      monthlyAnswerInput.value.trim(),

    theme1_category:
      theme1CategoryInput.value,

    theme1_body:
      theme1BodyInput.value.trim(),

    theme2_category:
      theme2CategoryInput.value,

    theme2_body:
      theme2BodyInput.value.trim(),

    theme3_category:
      theme3CategoryInput.value,

    theme3_body:
      theme3BodyInput.value.trim(),

    updated_at:
      new Date().toISOString()
  };

  try {
    const url =
      `${SUPABASE_URL}/rest/v1/improvements` +
      `?id=eq.${selectedRecord.id}`;

    const response =
      await portalFetch(
        url,
        {
          method:
            "PATCH",

          headers: {
            "Content-Type":
              "application/json",

            Prefer:
              "return=representation"
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
        "修正内容を保存できませんでした"
      );
    }

    const updatedRecords =
      await response.json();

    if (updatedRecords.length > 0) {
      selectedRecord =
        updatedRecords[0];
    }

    showMessage(
      "修正内容を保存しました。",
      "success"
    );

    await loadImprovements();

    renderImprovementList();

  } catch (error) {
    console.error(error);

    showMessage(
      error.message,
      "error"
    );

  } finally {
    saveChangesButton.disabled =
      false;

    saveChangesButton.textContent =
      "修正内容を保存";
  }
}


/* =========================================
   再編集可能に戻す
========================================= */

async function returnRecordToDraft() {
  hideMessage();

  if (!selectedRecord) {
    showMessage(
      "対象データが選択されていません",
      "error"
    );

    return;
  }

  if (
    selectedRecord.status !==
    "submitted"
  ) {
    showMessage(
      "このデータは提出済みではありません",
      "error"
    );

    return;
  }

  const confirmed =
    window.confirm(
      `${selectedRecord.employee_name}さんの` +
      `向上提案を再編集可能に戻しますか？`
    );

  if (!confirmed) {
    return;
  }

  returnDraftButton.disabled =
    true;

  returnDraftButton.textContent =
    "処理中...";

  const updateData = {
    status:
      "draft",

    submitted_at:
      null,

    updated_at:
      new Date().toISOString()
  };

  try {
    const url =
      `${SUPABASE_URL}/rest/v1/improvements` +
      `?id=eq.${selectedRecord.id}`;

    const response =
      await portalFetch(
        url,
        {
          method:
            "PATCH",

          headers: {
            "Content-Type":
              "application/json",

            Prefer:
              "return=representation"
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
        "再編集可能に戻せませんでした"
      );
    }

    const updatedRecords =
      await response.json();

    if (updatedRecords.length > 0) {
      selectedRecord =
        updatedRecords[0];
    }

    showMessage(
      "本人が再編集できる状態に戻しました。",
      "success"
    );

    detailStatusElement.textContent =
      "一時保存";

    detailStatusElement.className =
      "improvement-admin-detail-status " +
      "improvement-admin-status-draft";

    returnDraftButton.hidden =
      true;

    await loadImprovements();

    renderImprovementList();

  } catch (error) {
    console.error(error);

    showMessage(
      error.message,
      "error"
    );

  } finally {
    returnDraftButton.disabled =
      false;

    returnDraftButton.textContent =
      "再編集可能に戻す";
  }
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
   向上提案CSV出力
========================================= */

function exportImprovementCsv() {
  hideMessage();

  if (!monthInput.value) {
    showMessage(
      "対象月を選択してください",
      "error"
    );

    return;
  }

  const submittedRecords =
    improvements.filter(
      item =>
        item.status ===
        "submitted"
    );

  if (
    submittedRecords.length === 0
  ) {
    showMessage(
      "提出済みの向上提案がありません",
      "error"
    );

    return;
  }

  const csvRows = [];

  /*
    Excel取り込み用の並び
  */

  csvRows.push([
    "部署名",
    "氏名",
    "今月のテーマ回答",
    "テーマ①",
    "テーマ①本文",
    "テーマ②",
    "テーマ②本文",
    "テーマ③",
    "テーマ③本文"
  ]);

  submittedRecords.forEach(
    record => {

      csvRows.push([
        record.department || "",
        record.employee_name || "",
        record.monthly_theme_answer || "",
        record.theme1_category || "",
        record.theme1_body || "",
        record.theme2_category || "",
        record.theme2_body || "",
        record.theme3_category || "",
        record.theme3_body || ""
      ]);
    }
  );

  downloadCsv(
    csvRows,
    `向上提案_${monthInput.value}.csv`
  );

  showMessage(
    "提出済みデータをCSV出力しました。",
    "success"
  );
}

/* =========================================
   今月のテーマ保存
========================================= */

async function saveMonthlyTheme() {
  hideMessage();

  const targetMonth =
    monthValueToDate(
      monthInput.value
    );

  const monthlyTheme =
    themeSettingInput.value.trim();

  if (!targetMonth) {
    showMessage(
      "対象月を選択してください",
      "error"
    );

    return;
  }

  if (!monthlyTheme) {
    showMessage(
      "今月のテーマを入力してください",
      "error"
    );

    return;
  }

  const confirmed =
    window.confirm(
      `${monthInput.value}の今月のテーマを保存しますか？`
    );

  if (!confirmed) {
    return;
  }

  saveThemeButton.disabled = true;

  saveThemeButton.textContent =
    "保存中...";

  const saveData = {
    target_month:
      targetMonth,

    monthly_theme:
      monthlyTheme,

    is_published:
      true,

    updated_at:
      new Date().toISOString()
  };

  try {
    let url =
      `${SUPABASE_URL}/rest/v1/improvement_settings`;

    let method =
      "POST";

    if (currentSetting?.id) {
      url +=
        `?id=eq.${currentSetting.id}`;

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
              "return=representation"
          },

          body:
            JSON.stringify(
              saveData
            )
        }
      );

    if (!response.ok) {
      const errorText =
        await response.text();

      console.error(errorText);

      throw new Error(
        "今月のテーマを保存できませんでした"
      );
    }

    const savedSettings =
      await response.json();

    if (savedSettings.length > 0) {
      currentSetting =
        savedSettings[0];
    }

    themeSettingInput.value =
      currentSetting?.monthly_theme ||
      monthlyTheme;

    showMessage(
      "今月のテーマを保存しました。",
      "success"
    );

  } catch (error) {
    console.error(error);

    showMessage(
      error.message,
      "error"
    );

  } finally {
    saveThemeButton.disabled =
      false;

    saveThemeButton.textContent =
      "今月のテーマを保存";
  }
}

/* =========================================
   管理画面読込
========================================= */

async function loadAdminScreen() {
  /*
    管理者情報がまだ取得できていない場合は、
    ここで改めて確認する
  */

  if (!loginUser) {
    loginUser =
      checkAdminAccess();
  }

  if (!loginUser) {
    return;
  }

  hideMessage();

  detailSection.classList.add(
    "hidden"
  );

  listElement.innerHTML =
    '<p class="improvement-admin-empty">' +
    '読み込み中...' +
    '</p>';

  summaryElement.textContent =
    "読み込み中...";

  reloadButton.disabled =
    true;

  exportCsvButton.disabled =
    true;

  saveThemeButton.disabled =
    true;

  reloadButton.textContent =
    "読込中...";

  try {
    if (!monthInput.value) {
      throw new Error(
        "対象月を選択してください"
      );
    }

    await Promise.all([
      loadEmployees(),
      loadMonthlySetting(),
      loadImprovements()
    ]);

    renderImprovementList();

    if (!currentSetting) {
      showMessage(
        "この対象月のテーマ設定は未登録です。",
        "info"
      );
    }

  } catch (error) {
    console.error(error);

    listElement.innerHTML =
      '<p class="improvement-admin-empty">' +
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

    saveThemeButton.disabled =
      false;

    reloadButton.textContent =
      "更新";
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

  createCategoryOptions();

  try {
    await loadLatestPublishedSetting();

    await loadAdminScreen();

  } catch (error) {
    console.error(error);

    showMessage(
      error.message,
      "error"
    );
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


exportCsvButton.addEventListener(
  "click",
  exportImprovementCsv
);

saveThemeButton.addEventListener(
  "click",
  saveMonthlyTheme
);

closeDetailButton.addEventListener(
  "click",
  closeDetail
);


editForm.addEventListener(
  "submit",
  saveAdminChanges
);


returnDraftButton.addEventListener(
  "click",
  returnRecordToDraft
);


/* =========================================
   実行
========================================= */

initializePage();