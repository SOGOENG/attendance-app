/* =========================================
   Supabase接続設定
========================================= */

const SUPABASE_URL =
  "https://fgmvmbjnoyagnpygcbky.supabase.co";



/* =========================================
   HTML要素
========================================= */

const backHomeButton =
  document.getElementById(
    "backHomeButton"
  );

const departmentDisplay =
  document.getElementById(
    "departmentDisplay"
  );

const employeeNameDisplay =
  document.getElementById(
    "employeeNameDisplay"
  );

const targetMonthDisplay =
  document.getElementById(
    "targetMonthDisplay"
  );

const deadlineDisplay =
  document.getElementById(
    "deadlineDisplay"
  );

const monthlyThemeDisplay =
  document.getElementById(
    "monthlyThemeDisplay"
  );

const submissionStatusMessage =
  document.getElementById(
    "submissionStatusMessage"
  );

const improvementForm =
  document.getElementById(
    "improvementForm"
  );

const monthlyThemeAnswer =
  document.getElementById(
    "monthlyThemeAnswer"
  );

const theme1Category =
  document.getElementById(
    "theme1Category"
  );

const theme1Body =
  document.getElementById(
    "theme1Body"
  );

const theme2Category =
  document.getElementById(
    "theme2Category"
  );

const theme2Body =
  document.getElementById(
    "theme2Body"
  );

const theme3Category =
  document.getElementById(
    "theme3Category"
  );

const theme3Body =
  document.getElementById(
    "theme3Body"
  );

const draftButton =
  document.getElementById(
    "draftButton"
  );

const submitButton =
  document.getElementById(
    "submitButton"
  );

const messageBox =
  document.getElementById(
    "messageBox"
  );

const loadingOverlay =
  document.getElementById(
    "loadingOverlay"
  );

const loadingMessage =
  document.getElementById(
    "loadingMessage"
  );

const improvementHistoryList =
  document.getElementById(
    "improvementHistoryList"
  );

const historyFiscalYearSelect =
  document.getElementById(
    "historyFiscalYearSelect"
  );

const historyMonthSelect =
  document.getElementById(
    "historyMonthSelect"
  );

const historyShowButton =
  document.getElementById(
    "historyShowButton"
  );  

const improvementHistoryDetail =
  document.getElementById(
    "improvementHistoryDetail"
  );

const improvementHistoryDetailTitle =
  document.getElementById(
    "improvementHistoryDetailTitle"
  );

const improvementHistoryDetailContent =
  document.getElementById(
    "improvementHistoryDetailContent"
  );

const improvementHistoryClose =
  document.getElementById(
    "improvementHistoryClose"
  );


/* =========================================
   現在使用中のデータ
========================================= */

let loginUser = null;

let currentSetting = null;

let currentRecord = null;

let improvementHistoryRecords = [];


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
   ログイン情報取得
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
  if (!messageBox) {
    return;
  }

  messageBox.textContent =
    message;

  messageBox.className =
    `form-message ${type}`;
}


function hideMessage() {
  if (!messageBox) {
    return;
  }

  messageBox.textContent = "";

  messageBox.className =
    "form-message hidden";
}


/* =========================================
   提出状態表示
========================================= */

function showSubmissionStatus(
  status
) {
  if (!submissionStatusMessage) {
    return;
  }

  submissionStatusMessage.className =
    "submission-status-message";

  if (status === "submitted") {
    submissionStatusMessage.textContent =
      "🟢 提出済みです。下に提出した内容を表示しています。";

    submissionStatusMessage.classList.add(
      "submitted"
    );

    return;
  }

  if (status === "draft") {
    submissionStatusMessage.textContent =
      "🟡 一時保存済みです。まだ提出されていません。";

    submissionStatusMessage.classList.add(
      "draft"
    );

    return;
  }

  submissionStatusMessage.textContent =
    "⚪ まだ提出されていません。";

  submissionStatusMessage.classList.add(
    "not-submitted"
  );
}


/* =========================================
   入力欄のロック
========================================= */

function lockForm() {
  const formElements = [
    monthlyThemeAnswer,
    theme1Category,
    theme1Body,
    theme2Category,
    theme2Body,
    theme3Category,
    theme3Body
  ];

  formElements.forEach(element => {
    if (!element) {
      return;
    }

    element.disabled = true;
  });

  if (draftButton) {
    draftButton.classList.add(
      "hidden"
    );
  }

  if (submitButton) {
    submitButton.classList.add(
      "hidden"
    );
  }
}


/* =========================================
   入力欄のロック解除
========================================= */

function unlockForm() {
  const formElements = [
    monthlyThemeAnswer,
    theme1Category,
    theme1Body,
    theme2Category,
    theme2Body,
    theme3Category,
    theme3Body
  ];

  formElements.forEach(element => {
    if (!element) {
      return;
    }

    element.disabled = false;
  });

  if (draftButton) {
    draftButton.classList.remove(
      "hidden"
    );
  }

  if (submitButton) {
    submitButton.classList.remove(
      "hidden"
    );
  }
}


/* =========================================
   日付表示
========================================= */

function formatTargetMonth(
  dateText
) {
  if (!dateText) {
    return "未設定";
  }

  const date =
    new Date(
      `${dateText}T00:00:00`
    );

  return (
    `${date.getFullYear()}年` +
    `${date.getMonth() + 1}月分`
  );
}


function formatJapaneseDate(
  dateText
) {
  if (!dateText) {
    return "未設定";
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


/* =========================================
   分類プルダウン作成
========================================= */

function createCategoryOptions() {
  const categorySelects = [
    theme1Category,
    theme2Category,
    theme3Category
  ];

  categorySelects.forEach(
    selectElement => {

      if (!selectElement) {
        return;
      }

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
   公開中の月別設定を取得
========================================= */

async function loadPublishedSetting() {
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
      "今月のテーマを読み込めませんでした"
    );
  }

  const settings =
    await response.json();

  if (settings.length === 0) {
    throw new Error(
      "公開中の向上提案テーマがありません"
    );
  }

  currentSetting =
    settings[0];
}

/* =========================================
   画面へ設定を表示
========================================= */

function displayScreenData() {
  departmentDisplay.textContent =
    loginUser.department ||
    "部署未設定";

  employeeNameDisplay.textContent =
    loginUser.name ||
    "氏名未設定";

  targetMonthDisplay.textContent =
    formatTargetMonth(
      currentSetting.target_month
    );

  deadlineDisplay.textContent =
    formatJapaneseDate(
      currentSetting.deadline
    );

  monthlyThemeDisplay.textContent =
    currentSetting.monthly_theme ||
    "今月のテーマは未設定です";
}


/* =========================================
   既存データ読込
========================================= */

async function loadExistingImprovement() {
  showSubmissionStatus(
  "not_submitted"
);

  unlockForm();

  currentRecord = null;

  const targetMonth =
    currentSetting.target_month;

  const department =
    encodeURIComponent(
      loginUser.department || ""
    );

  const employeeName =
    encodeURIComponent(
      loginUser.name || ""
    );

  const url =
    `${SUPABASE_URL}/rest/v1/improvements` +
    `?select=*` +
    `&target_month=eq.${targetMonth}` +
    `&department=eq.${department}` +
    `&employee_name=eq.${employeeName}` +
    `&limit=1`;

  const response =
    await portalFetch(url);

  if (!response.ok) {
    const errorText =
      await response.text();

    console.error(errorText);

    throw new Error(
      "保存済みデータを読み込めませんでした"
    );
  }

  const records =
    await response.json();

  if (records.length === 0) {
    return;
  }

  currentRecord =
    records[0];

  monthlyThemeAnswer.value =
    currentRecord.monthly_theme_answer || "";

  theme1Category.value =
    currentRecord.theme1_category || "";

  theme1Body.value =
    currentRecord.theme1_body || "";

  theme2Category.value =
    currentRecord.theme2_category || "";

  theme2Body.value =
    currentRecord.theme2_body || "";

  theme3Category.value =
    currentRecord.theme3_category || "";

  theme3Body.value =
    currentRecord.theme3_body || "";

  if (
    currentRecord.status ===
    "submitted"
  ) {
    showSubmissionStatus(
  "submitted"
);

    lockForm();

  } else {
    showMessage(
      "一時保存した内容を復元しました。",
      "info"
    );
  }
}

/* =========================================
   過去の向上提案取得
========================================= */

async function loadImprovementHistory() {
  improvementHistoryRecords = [];

  const department =
    encodeURIComponent(
      loginUser.department || ""
    );

  const employeeName =
    encodeURIComponent(
      loginUser.name || ""
    );

  const url =
    `${SUPABASE_URL}/rest/v1/improvements` +
    `?select=*` +
    `&department=eq.${department}` +
    `&employee_name=eq.${employeeName}` +
    `&status=eq.submitted` +
    `&order=target_month.desc`;

  const response =
    await portalFetch(url);

  if (!response.ok) {
    const errorText =
      await response.text();

    console.error(errorText);

    throw new Error(
      "過去の向上提案を読み込めませんでした"
    );
  }

  improvementHistoryRecords =
    await response.json();
}

/* =========================================
   提出日時表示
========================================= */

function formatSubmissionDateTime(
  dateText
) {
  if (!dateText) {
    return "提出日時不明";
  }

  const date =
    new Date(dateText);

  return (
    `${date.getFullYear()}年` +
    `${date.getMonth() + 1}月` +
    `${date.getDate()}日 ` +
    `${String(date.getHours()).padStart(2, "0")}:` +
    `${String(date.getMinutes()).padStart(2, "0")}`
  );
}


/* =========================================
   過去の向上提案一覧表示
========================================= */

function getFiscalYearFromTargetMonth(
  targetMonth
) {
  if (!targetMonth) {
    return null;
  }

  const date =
    new Date(
      `${targetMonth}T00:00:00`
    );

  const year =
    date.getFullYear();

  const month =
    date.getMonth() + 1;

  return month >= 4
    ? year
    : year - 1;
}


function setupHistoryFiscalYears() {
  historyFiscalYearSelect.innerHTML = "";

  if (
    improvementHistoryRecords.length === 0
  ) {
    const option =
      document.createElement(
        "option"
      );

    option.value = "";

    option.textContent =
      "履歴なし";

    historyFiscalYearSelect.appendChild(
      option
    );

    return;
  }

  const fiscalYears =
    [
      ...new Set(
        improvementHistoryRecords
          .map(
            record =>
              getFiscalYearFromTargetMonth(
                record.target_month
              )
          )
          .filter(
            year =>
              year !== null
          )
      )
    ]
      .sort(
        (a, b) => b - a
      );

  fiscalYears.forEach(
    fiscalYear => {
      const option =
        document.createElement(
          "option"
        );

      option.value =
        String(fiscalYear);

      option.textContent =
        `${fiscalYear}年度`;

      historyFiscalYearSelect.appendChild(
        option
      );
    }
  );
}

function setupHistoryMonths() {
  historyMonthSelect.innerHTML = "";

  const selectedFiscalYear =
    Number(
      historyFiscalYearSelect.value
    );

  if (!selectedFiscalYear) {
    const option =
      document.createElement(
        "option"
      );

    option.value = "";

    option.textContent =
      "月を選択";

    historyMonthSelect.appendChild(
      option
    );

    return;
  }

  const months =
    improvementHistoryRecords
      .filter(
        record =>
          getFiscalYearFromTargetMonth(
            record.target_month
          ) === selectedFiscalYear
      )
      .map(
        record =>
          record.target_month
      )
      .filter(
        (
          targetMonth,
          index,
          array
        ) =>
          array.indexOf(
            targetMonth
          ) === index
      )
      .sort(
        (a, b) =>
          new Date(b) -
          new Date(a)
      );

  if (months.length === 0) {
    const option =
      document.createElement(
        "option"
      );

    option.value = "";

    option.textContent =
      "履歴なし";

    historyMonthSelect.appendChild(
      option
    );

    return;
  }

  months.forEach(
    targetMonth => {
      const option =
        document.createElement(
          "option"
        );

      option.value =
        targetMonth;

      option.textContent =
        formatTargetMonth(
          targetMonth
        );

      historyMonthSelect.appendChild(
        option
      );
    }
  );
}

function displayImprovementHistory() {
  improvementHistoryList.innerHTML = "";

  if (
    improvementHistoryRecords.length === 0
  ) {
    const emptyMessage =
      document.createElement("p");

    emptyMessage.textContent =
      "過去に提出した向上提案はありません。";

    emptyMessage.style.margin =
      "0";

    emptyMessage.style.color =
      "#64748b";

    emptyMessage.style.textAlign =
      "center";

    improvementHistoryList.appendChild(
      emptyMessage
    );

    return;
  }

  improvementHistoryRecords.forEach(
    record => {
      const button =
        document.createElement("button");

      button.type =
        "button";

      button.style.width =
        "100%";

      button.style.padding =
        "13px 14px";

      button.style.display =
        "flex";

      button.style.justifyContent =
        "space-between";

      button.style.alignItems =
        "center";

      button.style.gap =
        "12px";

      button.style.color =
        "#0f172a";

      button.style.background =
        "#f8fafc";

      button.style.border =
        "1px solid #e2e8f0";

      button.style.borderRadius =
        "10px";

      button.style.cursor =
        "pointer";

      const monthText =
        document.createElement("strong");

      monthText.textContent =
        formatTargetMonth(
          record.target_month
        );

      const viewText =
        document.createElement("span");

      viewText.textContent =
        "内容を見る 〉";

      viewText.style.color =
        "#2563eb";

      viewText.style.fontWeight =
        "700";

      button.appendChild(
        monthText
      );

      button.appendChild(
        viewText
      );

      button.addEventListener(
        "click",
        () => {
          showImprovementHistoryDetail(
            record
          );
        }
      );

      improvementHistoryList.appendChild(
        button
      );
    }
  );
}


/* =========================================
   過去の提出内容へ項目追加
========================================= */

function addHistoryDetailItem(
  label,
  value
) {
  const item =
    document.createElement("div");

  item.style.marginBottom =
    "12px";

  item.style.padding =
    "13px 14px";

  item.style.background =
    "#f8fafc";

  item.style.border =
    "1px solid #e2e8f0";

  item.style.borderRadius =
    "10px";

  const labelElement =
    document.createElement("strong");

  labelElement.textContent =
    label;

  labelElement.style.display =
    "block";

  labelElement.style.marginBottom =
    "6px";

  labelElement.style.color =
    "#475569";

  labelElement.style.fontSize =
    "13px";

  const valueElement =
    document.createElement("p");

  valueElement.textContent =
    value || "未入力";

  valueElement.style.margin =
    "0";

  valueElement.style.color =
    "#0f172a";

  valueElement.style.lineHeight =
    "1.7";

  valueElement.style.whiteSpace =
    "pre-wrap";

  valueElement.style.overflowWrap =
    "anywhere";

  item.appendChild(
    labelElement
  );

  item.appendChild(
    valueElement
  );

  improvementHistoryDetailContent.appendChild(
    item
  );
}


/* =========================================
   過去の提出内容表示
========================================= */

function showImprovementHistoryDetail(
  record
) {
  improvementHistoryDetailContent.innerHTML =
    "";

  improvementHistoryDetailTitle.textContent =
    `${formatTargetMonth(record.target_month)}の提出内容`;

  addHistoryDetailItem(
    "提出日時",
    formatSubmissionDateTime(
      record.submitted_at
    )
  );

  addHistoryDetailItem(
    "今月のテーマ",
    record.monthly_theme
  );

  addHistoryDetailItem(
    "今月のテーマへの回答",
    record.monthly_theme_answer
  );

  addHistoryDetailItem(
    `テーマ①　${record.theme1_category || ""}`,
    record.theme1_body
  );

  addHistoryDetailItem(
    `テーマ②　${record.theme2_category || ""}`,
    record.theme2_body
  );

  addHistoryDetailItem(
    `テーマ③　${record.theme3_category || ""}`,
    record.theme3_body
  );

  improvementHistoryDetail.classList.remove(
    "hidden"
  );

  improvementHistoryDetail.scrollIntoView({
    behavior:
      "smooth",

    block:
      "start"
  });
}

/* =========================================
   過去の提出内容を閉じる
========================================= */

function closeImprovementHistoryDetail() {
  improvementHistoryDetail.classList.add(
    "hidden"
  );

  improvementHistoryList.scrollIntoView({
    behavior:
      "smooth",

    block:
      "start"
  });
}

/* =========================================
   保存用データ作成
========================================= */

function createSaveData(
  status
) {
  return {
    target_month:
      currentSetting.target_month,

    department:
      loginUser.department || "",

    employee_name:
      loginUser.name || "",

    monthly_theme:
      currentSetting.monthly_theme || "",

    monthly_theme_answer:
      monthlyThemeAnswer.value.trim(),

    theme1_category:
      theme1Category.value,

    theme1_body:
      theme1Body.value.trim(),

    theme2_category:
      theme2Category.value,

    theme2_body:
      theme2Body.value.trim(),

    theme3_category:
      theme3Category.value,

    theme3_body:
      theme3Body.value.trim(),

    status:
      status,

    submitted_at:
      status === "submitted"
        ? new Date().toISOString()
        : null,

    updated_at:
      new Date().toISOString()
  };
}


/* =========================================
   提出時入力確認
========================================= */

function validateSubmission() {
  if (
    !monthlyThemeAnswer.value.trim()
  ) {
    throw new Error(
      "今月のテーマの本文を入力してください"
    );
  }

  if (!theme1Category.value) {
    throw new Error(
      "テーマ①の分類を選択してください"
    );
  }

  if (!theme1Body.value.trim()) {
    throw new Error(
      "テーマ①の本文を入力してください"
    );
  }

  if (!theme2Category.value) {
    throw new Error(
      "テーマ②の分類を選択してください"
    );
  }

  if (!theme2Body.value.trim()) {
    throw new Error(
      "テーマ②の本文を入力してください"
    );
  }

  if (!theme3Category.value) {
    throw new Error(
      "テーマ③の分類を選択してください"
    );
  }

  if (!theme3Body.value.trim()) {
    throw new Error(
      "テーマ③の本文を入力してください"
    );
  }
}


/* =========================================
   Supabaseへ保存
========================================= */

async function saveImprovement(
  status
) {
  hideMessage();

  if (!loginUser || !currentSetting) {
    throw new Error(
      "ログイン情報または月別設定がありません"
    );
  }

  if (
    currentRecord &&
    currentRecord.status ===
    "submitted"
  ) {
    throw new Error(
      "この向上提案は提出済みです"
    );
  }

  if (status === "submitted") {
    validateSubmission();
  }

  const saveData =
    createSaveData(status);

  const url =
    `${SUPABASE_URL}/rest/v1/improvements` +
    `?on_conflict=target_month,department,employee_name`;

  const response =
    await portalFetch(
      url,
      {
        method:
          "POST",

        headers: {
          "Content-Type":
            "application/json",

          Prefer:
            "resolution=merge-duplicates,return=representation"
        },

        body:
          JSON.stringify(saveData)
      }
    );

  if (!response.ok) {
    const errorText =
      await response.text();

    console.error(errorText);

    throw new Error(
      status === "submitted"
        ? "向上提案を提出できませんでした"
        : "向上提案を一時保存できませんでした"
    );
  }

  const savedRecords =
    await response.json();

  if (savedRecords.length > 0) {
    currentRecord =
      savedRecords[0];
  }
}

/* =========================================
   一時保存
========================================= */

async function handleDraftSave() {
  const confirmed =
    window.confirm(
      "入力内容を一時保存しますか？"
    );

  if (!confirmed) {
    return;
  }

  try {
    showLoading(
      "一時保存しています..."
    );

    await saveImprovement(
      "draft"
    );

    showSubmissionStatus(
  "not_submitted"
);

    unlockForm();

    showMessage(
      "一時保存しました。",
      "success"
    );

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
   提出
========================================= */

async function handleSubmit(
  event
) {
  event.preventDefault();

  hideMessage();

  try {
    validateSubmission();

  } catch (error) {
    showMessage(
      error.message,
      "error"
    );

    window.scrollTo({
      top: 0,
      behavior: "smooth"
    });

    return;
  }


  const confirmed =
    window.confirm(
      "向上提案を提出しますか？"
    );

  if (!confirmed) {
    return;
  }


  try {
    showLoading(
      "提出しています..."
    );

    await saveImprovement(
      "submitted"
    );

    showSubmissionStatus(
  "submitted"
);

    lockForm();


    window.scrollTo({
      top: 0,
      behavior: "smooth"
    });

  } catch (error) {
    console.error(error);

    showMessage(
      error.message,
      "error"
    );

    window.scrollTo({
      top: 0,
      behavior: "smooth"
    });

  } finally {
    hideLoading();
  }
}


/* =========================================
   初期表示
========================================= */

async function initializeImprovementPage() {
  try {
    showLoading(
      "向上提案を読み込んでいます..."
    );

    loginUser =
      getLoginUser();

    if (!loginUser) {
      window.location.href =
        "login.html";

      return;
    }

    createCategoryOptions();

    await loadPublishedSetting();

    displayScreenData();

    await loadExistingImprovement();

    await loadImprovementHistory();

setupHistoryFiscalYears();

setupHistoryMonths();

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

backHomeButton.addEventListener(
  "click",
  () => {
    window.location.href =
      "home.html";
  }
);

draftButton.addEventListener(
  "click",
  handleDraftSave
);

improvementForm.addEventListener(
  "submit",
  handleSubmit
);

historyFiscalYearSelect.addEventListener(
  "change",
  () => {
    setupHistoryMonths();

    improvementHistoryDetail.classList.add(
      "hidden"
    );
  }
);

historyShowButton.addEventListener(
  "click",
  () => {
    const selectedTargetMonth =
      historyMonthSelect.value;

    if (!selectedTargetMonth) {
      showMessage(
        "月を選択してください。",
        "info"
      );

      return;
    }

    const selectedRecord =
      improvementHistoryRecords.find(
        record =>
          record.target_month ===
          selectedTargetMonth
      );

    if (!selectedRecord) {
      showMessage(
        "選択した月の向上提案が見つかりません。",
        "error"
      );

      return;
    }

    hideMessage();

    showImprovementHistoryDetail(
      selectedRecord
    );
  }
);

improvementHistoryClose.addEventListener(
  "click",
  closeImprovementHistoryDetail
);


/* =========================================
   実行
========================================= */

initializeImprovementPage();