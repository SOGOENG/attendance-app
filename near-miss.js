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

const currentMonthCountDisplay =
  document.getElementById(
    "currentMonthCountDisplay"
  );

const messageBox =
  document.getElementById(
    "messageBox"
  );

const nearMissForm =
  document.getElementById(
    "nearMissForm"
  );

const siteSelect =
  document.getElementById(
    "siteSelect"
  );

const siteOtherBox =
  document.getElementById(
    "siteOtherBox"
  );

const siteOtherInput =
  document.getElementById(
    "siteOtherInput"
  );

const clientSelect =
  document.getElementById(
    "clientSelect"
  );

const clientOtherBox =
  document.getElementById(
    "clientOtherBox"
  );

const clientOtherInput =
  document.getElementById(
    "clientOtherInput"
  );

const occurredDate =
  document.getElementById(
    "occurredDate"
  );

const occurredTime =
  document.getElementById(
    "occurredTime"
  );

const weatherSelect =
  document.getElementById(
    "weatherSelect"
  );

const workTypeSelect =
  document.getElementById(
    "workTypeSelect"
  );

const workTypeDetailBox =
  document.getElementById(
    "workTypeDetailBox"
  );

const workTypeDetail =
  document.getElementById(
    "workTypeDetail"
  );

const placeTypeSelect =
  document.getElementById(
    "placeTypeSelect"
  );

const placeDetailBox =
  document.getElementById(
    "placeDetailBox"
  );

const placeDetail =
  document.getElementById(
    "placeDetail"
  );

const actionTypeSelect =
  document.getElementById(
    "actionTypeSelect"
  );

const actionDetailBox =
  document.getElementById(
    "actionDetailBox"
  );

const actionDetail =
  document.getElementById(
    "actionDetail"
  );

const stateTypeSelect =
  document.getElementById(
    "stateTypeSelect"
  );

const stateDetailBox =
  document.getElementById(
    "stateDetailBox"
  );

const stateDetail =
  document.getElementById(
    "stateDetail"
  );

const measureTypeSelect =
  document.getElementById(
    "measureTypeSelect"
  );

const measureDetailBox =
  document.getElementById(
    "measureDetailBox"
  );

const measureDetail =
  document.getElementById(
    "measureDetail"
  );

const reflection =
  document.getElementById(
    "reflection"
  );

const draftButton =
  document.getElementById(
    "draftButton"
  );

const submitButton =
  document.getElementById(
    "submitButton"
  );

const nearMissHistoryList =
  document.getElementById(
    "nearMissHistoryList"
  );

const loadingOverlay =
  document.getElementById(
    "loadingOverlay"
  );

const loadingMessage =
  document.getElementById(
    "loadingMessage"
  );


/* =========================================
   現在使用中のデータ
========================================= */

let loginUser = null;

let targetMonth = null;

let currentDraft = null;

let siteRecords = [];


/* =========================================
   選択肢
========================================= */

const workTypeOptions = [
  "建設機械の運転作業中",
  "玉掛作業中",
  "工具の取扱作業中",
  "ガス（電気）溶接溶断作業中",
  "配管作業中",
  "埋設配管作業中",
  "配管材加工中",
  "資材搬出入中",
  "材料移動運搬中",
  "スリーブ・インサート取付中",
  "斫り作業中",
  "穴埋め作業中",
  "既設撤去中",
  "器具取付作業中",
  "足場組立解体中",
  "材料片付け清掃中",
  "試運転、テスト中",
  "調査、打合せ、寸法取中",
  "現場巡回、写真撮影中",
  "その他"
];

const placeTypeOptions = [
  "足場上で",
  "脚立、作業台上で",
  "はしご、タラップ上で",
  "鉄筋上で・鉄筋に",
  "型枠上で・型枠上に",
  "機械に",
  "工具に（を）",
  "通路上で",
  "高所作業車上で",
  "天井内で",
  "シャフト内で",
  "ピット内で",
  "床上で",
  "外部で",
  "加工場で",
  "仮設階段で",
  "階段で",
  "機械室等で",
  "機器等の上で",
  "その他"
];

const actionTypeOptions = [
  "墜落しそうになった",
  "落ちた",
  "落ちそうになった",
  "転んだ",
  "転びそうになった",
  "（　）が倒れた",
  "（　）が倒れそうになった",
  "（　）がすべった",
  "つまずいた",
  "（　）をはさまれた",
  "（　）をはさまれそうになった",
  "（　）にあたった",
  "（　）にあたりそうになった",
  "（　）を切った",
  "（　）を切りそうになった",
  "（　）が巻込まれた",
  "（　）が巻込まれそうになった",
  "（　）を落とした",
  "（　）を落としそうになった",
  "（　）をうった",
  "（　）をうちそうになった",
  "目にゴミが入った",
  "めまいがした",
  "感電した",
  "（　）をたたいた",
  "（　）をたたきそうになった",
  "埋まりそうになった",
  "ヤケドした",
  "火災になりそうになった",
  "その他"
];

const stateTypeOptions = [
  "よく見えなかった",
  "見にくかった",
  "よく聞こえなかった",
  "気がつかなかった",
  "見落とした",
  "知らなかった（連絡がなかった）",
  "わからなかった",
  "他の事を考えていた",
  "大丈夫だと思った",
  "面倒くさかった",
  "力負けした",
  "身体のバランスをくずした",
  "手が思うように動かなかった",
  "イライラ（カッカ）していた",
  "心配事があった",
  "連続作業でなれていた",
  "体勢が悪かった",
  "暗かった",
  "体調が悪かった",
  "その他"
];

const measureTypeOptions = [
  "周囲確認",
  "足元確認",
  "手元確認",
  "指差呼称の徹底",
  "声掛け・合図の確認",
  "作業手順の見直し",
  "整理整頓",
  "保護具の適正使用",
  "設備・工具の改善",
  "作業環境の整備",
  "体調管理",
  "作業姿勢",
  "その他"
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
   社員ID取得
========================================= */

function getLoginEmployeeId() {
  if (!loginUser) {
    return null;
  }

  return (
    loginUser.id ||
    loginUser.employee_id ||
    null
  );
}


/* =========================================
   読み込み表示
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
    `near-miss-message ${type}`;
}


function hideMessage() {
  if (!messageBox) {
    return;
  }

  messageBox.textContent = "";

  messageBox.className =
    "near-miss-message hidden";
}


/* =========================================
   日付関連
========================================= */

function formatDateForInput(date) {
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


/*
  提出月の決め方

  1日～20日：
  当月20日提出分

  21日～月末：
  翌月20日提出分
*/
/*
  ヒヤリ発生日から提出対象月を決める

  1日～20日：
  当月20日締め

  21日～月末：
  翌月20日締め
*/
function getTargetMonthFromOccurredDate(
  dateText
) {
  if (!dateText) {
    return null;
  }

  const date =
    new Date(
      `${dateText}T00:00:00`
    );

  let year =
    date.getFullYear();

  let month =
    date.getMonth();

  if (date.getDate() >= 21) {
    month += 1;

    if (month >= 12) {
      year += 1;
      month = 0;
    }
  }

  return (
    `${year}-` +
    `${String(month + 1).padStart(2, "0")}-01`
  );
}


function formatTargetMonthLabel(
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
    `${date.getMonth() + 1}/20提出`
  );
}


function formatSubmittedDate(
  dateText
) {
  if (!dateText) {
    return "日時不明";
  }

  const date =
    new Date(dateText);

  return (
    `${date.getFullYear()}/` +
    `${date.getMonth() + 1}/` +
    `${date.getDate()}`
  );
}


/* =========================================
   共通プルダウン作成
========================================= */

function createSelectOptions(
  selectElement,
  options
) {
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

  options.forEach(optionText => {
    const option =
      document.createElement(
        "option"
      );

    option.value =
      optionText;

    option.textContent =
      optionText;

    selectElement.appendChild(
      option
    );
  });
}


/* =========================================
   固定選択肢を作成
========================================= */

function createFixedOptions() {
  createSelectOptions(
    workTypeSelect,
    workTypeOptions
  );

  createSelectOptions(
    placeTypeSelect,
    placeTypeOptions
  );

  createSelectOptions(
    actionTypeSelect,
    actionTypeOptions
  );

  createSelectOptions(
    stateTypeSelect,
    stateTypeOptions
  );

  createSelectOptions(
    measureTypeSelect,
    measureTypeOptions
  );
}


/* =========================================
   現場一覧取得
========================================= */

async function loadSites() {
  const url =
    `${SUPABASE_URL}/rest/v1/sites` +
    `?select=*`;

  const response =
    await portalFetch(url);

  if (!response.ok) {
    const errorText =
      await response.text();

    console.error(errorText);

    throw new Error(
      "現場一覧を読み込めませんでした"
    );
  }

  siteRecords =
    await response.json();

  siteRecords.sort((a, b) => {
    const nameA =
      getSiteDisplayName(a);

    const nameB =
      getSiteDisplayName(b);

    return nameA.localeCompare(
      nameB,
      "ja"
    );
  });

  createSiteOptions();
}


/* =========================================
   現場表示名取得
========================================= */

function getSiteDisplayName(site) {
  return (
    site.display_name ||
    site.site_name ||
    site.name ||
    ""
  );
}


/* =========================================
   現場ID取得
========================================= */

function getSiteId(site) {
  return (
    site.id ||
    site.site_id ||
    null
  );
}


/* =========================================
   現場の元請取得
========================================= */

function getSiteClientName(site) {
  return (
    site.client_name ||
    site.main_contractor ||
    site.customer_name ||
    ""
  );
}


/* =========================================
   現場プルダウン作成
========================================= */

function createSiteOptions() {
  siteSelect.innerHTML = "";

  const emptyOption =
    document.createElement(
      "option"
    );

  emptyOption.value = "";

  emptyOption.textContent =
    "選択してください";

  siteSelect.appendChild(
    emptyOption
  );

  siteRecords.forEach(site => {
    const siteName =
      getSiteDisplayName(site);

    if (!siteName) {
      return;
    }

    const option =
      document.createElement(
        "option"
      );

    option.value =
      String(
        getSiteId(site) || ""
      );

    option.textContent =
      siteName;

    siteSelect.appendChild(
      option
    );
  });

  const companyOption =
    document.createElement(
      "option"
    );

  companyOption.value =
    "__company__";

  companyOption.textContent =
    "会社（加工場）";

  siteSelect.appendChild(
    companyOption
  );

  const ownWorkOption =
    document.createElement(
      "option"
    );

  ownWorkOption.value =
    "__own_work__";

  ownWorkOption.textContent =
    "自社雑工事（営業等）";

  siteSelect.appendChild(
    ownWorkOption
  );

  const otherWorkOption =
    document.createElement(
      "option"
    );

  otherWorkOption.value =
    "__other_work__";

  otherWorkOption.textContent =
    "その他雑工事";

  siteSelect.appendChild(
    otherWorkOption
  );

  const otherOption =
    document.createElement(
      "option"
    );

  otherOption.value =
    "__other__";

  otherOption.textContent =
    "その他";

  siteSelect.appendChild(
    otherOption
  );
}


/* =========================================
   選択中の現場情報
========================================= */

function getSelectedSiteData() {
  const selectedValue =
    siteSelect.value;

  if (!selectedValue) {
    return {
      siteId: null,
      siteName: ""
    };
  }

  if (selectedValue === "__company__") {
    return {
      siteId: null,
      siteName:
        "会社（加工場）"
    };
  }

  if (selectedValue === "__own_work__") {
    return {
      siteId: null,
      siteName:
        "自社雑工事（営業等）"
    };
  }

  if (selectedValue === "__other_work__") {
    return {
      siteId: null,
      siteName:
        "その他雑工事"
    };
  }

  if (selectedValue === "__other__") {
    return {
      siteId: null,
      siteName:
        siteOtherInput.value.trim()
    };
  }

  const selectedSite =
    siteRecords.find(site => {
      return (
        String(getSiteId(site)) ===
        String(selectedValue)
      );
    });

  return {
    siteId:
      selectedSite
        ? getSiteId(selectedSite)
        : null,

    siteName:
      selectedSite
        ? getSiteDisplayName(selectedSite)
        : ""
  };
}


/* =========================================
   元請名取得
========================================= */

function getSelectedClientName() {
  if (
    clientSelect.value ===
    "その他"
  ) {
    return (
      clientOtherInput.value.trim()
    );
  }

  return clientSelect.value;
}


/* =========================================
   現場選択時
========================================= */

function handleSiteChange() {
  const selectedValue =
    siteSelect.value;

  if (
    selectedValue ===
    "__other__"
  ) {
    siteOtherBox.classList.remove(
      "hidden"
    );

  } else {
    siteOtherBox.classList.add(
      "hidden"
    );

    siteOtherInput.value = "";
  }

  const selectedSite =
    siteRecords.find(site => {
      return (
        String(getSiteId(site)) ===
        String(selectedValue)
      );
    });

  if (selectedSite) {
    const clientName =
      getSiteClientName(selectedSite);

    if (clientName) {
      const matchingOption =
        Array.from(
          clientSelect.options
        ).find(option => {
          return (
            option.value ===
            clientName
          );
        });

      if (matchingOption) {
        clientSelect.value =
          clientName;

        handleClientChange();
      }
    }
  }

  if (selectedValue === "__company__") {
    clientSelect.value =
      "自社";

    handleClientChange();
  }
}


/* =========================================
   元請選択時
========================================= */

function handleClientChange() {
  if (
    clientSelect.value ===
    "その他"
  ) {
    clientOtherBox.classList.remove(
      "hidden"
    );

  } else {
    clientOtherBox.classList.add(
      "hidden"
    );

    clientOtherInput.value = "";
  }
}


/* =========================================
   その他入力欄表示
========================================= */

function toggleOtherDetail(
  selectElement,
  detailBox,
  detailInput
) {
  if (
    selectElement.value ===
    "その他"
  ) {
    detailBox.classList.remove(
      "hidden"
    );

  } else {
    detailBox.classList.add(
      "hidden"
    );

    detailInput.value = "";
  }
}


/* =========================================
   どうしたか補足欄表示
========================================= */

function handleActionTypeChange() {
  const selectedValue =
    actionTypeSelect.value;

  const needsDetail =
    selectedValue.includes("（　）") ||
    selectedValue === "その他";

  if (needsDetail) {
    actionDetailBox.classList.remove(
      "hidden"
    );

  } else {
    actionDetailBox.classList.add(
      "hidden"
    );

    actionDetail.value = "";
  }
}


/* =========================================
   初期画面表示
========================================= */

function displayInitialData() {
  departmentDisplay.textContent =
    loginUser.department ||
    "部署未設定";

  employeeNameDisplay.textContent =
    loginUser.name ||
    "氏名未設定";

  targetMonthDisplay.textContent =
    formatTargetMonthLabel(
      targetMonth
    );

  if (!occurredDate.value) {
    occurredDate.value =
      formatDateForInput(
        new Date()
      );
  }
}


/* =========================================
   保存済み一時データ取得
========================================= */

async function loadCurrentDraft() {
  const department =
    encodeURIComponent(
      loginUser.department || ""
    );

  const employeeName =
    encodeURIComponent(
      loginUser.name || ""
    );

  const url =
    `${SUPABASE_URL}/rest/v1/near_misses` +
    `?select=*` +
    `&department=eq.${department}` +
    `&employee_name=eq.${employeeName}` +
    `&status=eq.draft` +
    `&order=updated_at.desc` +
    `&limit=1`;

  const response =
    await portalFetch(url);

  if (!response.ok) {
    const errorText =
      await response.text();

    console.error(errorText);

    throw new Error(
      "一時保存データを読み込めませんでした"
    );
  }

  const records =
    await response.json();

  if (records.length === 0) {
    currentDraft = null;
    return;
  }

  currentDraft =
    records[0];

  restoreDraftToForm();

  showMessage(
    "一時保存した内容を復元しました。",
    "info"
  );
}


/* =========================================
   一時保存データ復元
========================================= */

function restoreDraftToForm() {
  if (!currentDraft) {
    return;
  }

  restoreSiteSelection(
    currentDraft
  );

  restoreClientSelection(
    currentDraft.client_name || ""
  );

  occurredDate.value =
    currentDraft.occurred_date || "";

  occurredTime.value =
    currentDraft.occurred_time
      ? currentDraft.occurred_time.slice(0, 5)
      : "";

  weatherSelect.value =
    currentDraft.weather || "";

  workTypeSelect.value =
    currentDraft.work_type || "";

  workTypeDetail.value =
    currentDraft.work_type_detail || "";

  placeTypeSelect.value =
    currentDraft.place_type || "";

  placeDetail.value =
    currentDraft.place_detail || "";

  actionTypeSelect.value =
    currentDraft.action_type || "";

  actionDetail.value =
    currentDraft.action_detail || "";

  stateTypeSelect.value =
    currentDraft.state_type || "";

  stateDetail.value =
    currentDraft.state_detail || "";

  measureTypeSelect.value =
    currentDraft.measure_type || "";

  measureDetail.value =
    currentDraft.measure_detail || "";

  reflection.value =
    currentDraft.reflection || "";

  handleSiteChange();

  handleClientChange();

  toggleOtherDetail(
    workTypeSelect,
    workTypeDetailBox,
    workTypeDetail
  );

  toggleOtherDetail(
    placeTypeSelect,
    placeDetailBox,
    placeDetail
  );

  handleActionTypeChange();

  toggleOtherDetail(
    stateTypeSelect,
    stateDetailBox,
    stateDetail
  );

  toggleOtherDetail(
    measureTypeSelect,
    measureDetailBox,
    measureDetail
  );
}


/* =========================================
   現場選択状態復元
========================================= */

function restoreSiteSelection(record) {
  if (record.site_id) {
    siteSelect.value =
      String(record.site_id);

    return;
  }

  const siteName =
    record.site_name || "";

  if (siteName === "会社（加工場）") {
    siteSelect.value =
      "__company__";

    return;
  }

  if (
    siteName ===
    "自社雑工事（営業等）"
  ) {
    siteSelect.value =
      "__own_work__";

    return;
  }

  if (siteName === "その他雑工事") {
    siteSelect.value =
      "__other_work__";

    return;
  }

  if (siteName) {
    siteSelect.value =
      "__other__";

    siteOtherInput.value =
      siteName;
  }
}


/* =========================================
   元請選択状態復元
========================================= */

function restoreClientSelection(
  clientName
) {
  const matchingOption =
    Array.from(
      clientSelect.options
    ).find(option => {
      return (
        option.value ===
        clientName
      );
    });

  if (matchingOption) {
    clientSelect.value =
      clientName;

    return;
  }

  if (clientName) {
    clientSelect.value =
      "その他";

    clientOtherInput.value =
      clientName;
  }
}


/* =========================================
   提出件数・履歴取得
========================================= */

async function loadSubmissionHistory() {
  const department =
    encodeURIComponent(
      loginUser.department || ""
    );

  const employeeName =
    encodeURIComponent(
      loginUser.name || ""
    );

  const url =
    `${SUPABASE_URL}/rest/v1/near_misses` +
    `?select=target_month,submitted_at` +
    `&department=eq.${department}` +
    `&employee_name=eq.${employeeName}` +
    `&status=eq.submitted` +
    `&order=submitted_at.desc`;

  const response =
    await portalFetch(url);

  if (!response.ok) {
    const errorText =
      await response.text();

    console.error(errorText);

    throw new Error(
      "提出履歴を読み込めませんでした"
    );
  }

  const records =
    await response.json();

  const currentCount =
    records.filter(record => {
      return (
        record.target_month ===
        targetMonth
      );
    }).length;

  currentMonthCountDisplay.textContent =
    `${currentCount}件`;

  displaySubmissionHistory(
    records
  );
}


/* =========================================
   提出履歴表示
========================================= */

function displaySubmissionHistory(
  records
) {
  nearMissHistoryList.innerHTML = "";

  if (records.length === 0) {
    const emptyMessage =
      document.createElement(
        "p"
      );

    emptyMessage.className =
      "near-miss-history-empty";

    emptyMessage.textContent =
      "提出履歴はありません。";

    nearMissHistoryList.appendChild(
      emptyMessage
    );

    return;
  }

  const historyMap =
    new Map();

  records.forEach(record => {
    const dateLabel =
      formatSubmittedDate(
        record.submitted_at
      );

    const monthLabel =
      formatTargetMonthLabel(
        record.target_month
      );

    const key =
      `${dateLabel}|${monthLabel}`;

    const currentValue =
      historyMap.get(key) || {
        dateLabel,
        monthLabel,
        count: 0
      };

    currentValue.count += 1;

    historyMap.set(
      key,
      currentValue
    );
  });

  historyMap.forEach(item => {
    const row =
      document.createElement(
        "div"
      );

    row.className =
      "near-miss-history-row";

    const left =
      document.createElement(
        "span"
      );

    left.textContent =
      `${item.dateLabel}・${item.monthLabel}`;

    const right =
      document.createElement(
        "strong"
      );

    right.textContent =
      `${item.count}件`;

    row.appendChild(left);

    row.appendChild(right);

    nearMissHistoryList.appendChild(
      row
    );
  });
}


/* =========================================
   保存データ作成
========================================= */

function createSaveData(
  status,
  submissionNumber = null
) {
  const siteData =
    getSelectedSiteData();

  return {
    employee_id:
      getLoginEmployeeId(),

    department:
      loginUser.department || "",

    employee_name:
      loginUser.name || "",

    target_month:
  getTargetMonthFromOccurredDate(
    occurredDate.value
  ),

    status:
      status,

    site_id:
      siteData.siteId,

    site_name:
      siteData.siteName,

    client_name:
      getSelectedClientName(),

    occurred_date:
      occurredDate.value || null,

    occurred_time:
      occurredTime.value || null,

    weather:
      weatherSelect.value,

    work_type:
      workTypeSelect.value,

    work_type_detail:
      workTypeDetail.value.trim(),

    place_type:
      placeTypeSelect.value,

    place_detail:
      placeDetail.value.trim(),

    action_type:
      actionTypeSelect.value,

    action_detail:
      actionDetail.value.trim(),

    state_type:
      stateTypeSelect.value,

    state_detail:
      stateDetail.value.trim(),

    measure_type:
      measureTypeSelect.value,

    measure_detail:
      measureDetail.value.trim(),

    reflection:
      reflection.value.trim(),

    submitted_at:
      status === "submitted"
        ? new Date().toISOString()
        : null,

    updated_at:
      new Date().toISOString(),

    submission_number:
      submissionNumber
  };
}


/* =========================================
   提出時入力確認
========================================= */

function validateSubmission() {
  const siteData =
    getSelectedSiteData();

  if (!siteSelect.value) {
    throw new Error(
      "現場名を選択してください"
    );
  }

  if (
    siteSelect.value === "__other__" &&
    !siteData.siteName
  ) {
    throw new Error(
      "その他の現場名を入力してください"
    );
  }

  if (!clientSelect.value) {
    throw new Error(
      "元請を選択してください"
    );
  }

  if (
    clientSelect.value === "その他" &&
    !clientOtherInput.value.trim()
  ) {
    throw new Error(
      "その他の元請名を入力してください"
    );
  }

  if (!occurredDate.value) {
    throw new Error(
      "発生日を入力してください"
    );
  }

  if (!occurredTime.value) {
    throw new Error(
      "発生時刻を入力してください"
    );
  }

  if (!weatherSelect.value) {
    throw new Error(
      "天気を選択してください"
    );
  }

  if (!workTypeSelect.value) {
    throw new Error(
      "作業の種別を選択してください"
    );
  }

  if (
    workTypeSelect.value === "その他" &&
    !workTypeDetail.value.trim()
  ) {
    throw new Error(
      "その他の作業内容を入力してください"
    );
  }

  if (!placeTypeSelect.value) {
    throw new Error(
      "場所・物を選択してください"
    );
  }

  if (
    placeTypeSelect.value === "その他" &&
    !placeDetail.value.trim()
  ) {
    throw new Error(
      "その他の場所・物を入力してください"
    );
  }

  if (!actionTypeSelect.value) {
    throw new Error(
      "どうしたかを選択してください"
    );
  }

  const actionNeedsDetail =
    actionTypeSelect.value.includes(
      "（　）"
    ) ||
    actionTypeSelect.value ===
      "その他";

  if (
    actionNeedsDetail &&
    !actionDetail.value.trim()
  ) {
    throw new Error(
      "「どうしたか」の補足内容を入力してください"
    );
  }

  if (!stateTypeSelect.value) {
    throw new Error(
      "状態を選択してください"
    );
  }

  if (
    stateTypeSelect.value === "その他" &&
    !stateDetail.value.trim()
  ) {
    throw new Error(
      "その他の状態を入力してください"
    );
  }

  if (!measureTypeSelect.value) {
    throw new Error(
      "対策を選択してください"
    );
  }

  if (
    measureTypeSelect.value === "その他" &&
    !measureDetail.value.trim()
  ) {
    throw new Error(
      "その他の対策を入力してください"
    );
  }

  if (!reflection.value.trim()) {
    throw new Error(
      "対策・反省点等を入力してください"
    );
  }
}


/* =========================================
   一時保存
========================================= */

async function saveDraft() {
  const saveData =
    createSaveData(
      "draft",
      null
    );

  if (currentDraft) {
    const url =
      `${SUPABASE_URL}/rest/v1/near_misses` +
      `?id=eq.${currentDraft.id}`;

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
            JSON.stringify(saveData)
        }
      );

    if (!response.ok) {
      const errorText =
        await response.text();

      console.error(errorText);

      throw new Error(
        "一時保存を更新できませんでした"
      );
    }

    const records =
      await response.json();

    if (records.length > 0) {
      currentDraft =
        records[0];
    }

    return;
  }

  const url =
    `${SUPABASE_URL}/rest/v1/near_misses`;

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
            "return=representation"
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
      "一時保存できませんでした"
    );
  }

  const records =
    await response.json();

  if (records.length > 0) {
    currentDraft =
      records[0];
  }
}

/* =========================================
   今月の次回提出番号取得
========================================= */

async function getNextSubmissionNumber() {
  const department =
    encodeURIComponent(
      loginUser.department || ""
    );

  const employeeName =
    encodeURIComponent(
      loginUser.name || ""
    );

  const submissionTargetMonth =
  getTargetMonthFromOccurredDate(
    occurredDate.value
  );

const url =
  `${SUPABASE_URL}/rest/v1/near_misses` +
  `?select=id` +
  `&target_month=eq.${submissionTargetMonth}` +
  `&department=eq.${department}` +
  `&employee_name=eq.${employeeName}` +
  `&status=eq.submitted`;

  const response =
    await portalFetch(
      url,
      {
        headers: {
          Prefer:
            "count=exact"
        }
      }
    );

  if (!response.ok) {
    const errorText =
      await response.text();

    console.error(errorText);

    throw new Error(
      "提出番号を確認できませんでした"
    );
  }

  const contentRange =
    response.headers.get(
      "content-range"
    );

  if (contentRange) {
    const totalText =
      contentRange.split("/")[1];

    const total =
      Number(totalText);

    if (!Number.isNaN(total)) {
      return total + 1;
    }
  }

  const records =
    await response.json();

  return records.length + 1;
}


/* =========================================
   提出処理
========================================= */

async function submitNearMiss() {
  const submissionNumber =
    await getNextSubmissionNumber();

  const saveData =
    createSaveData(
      "submitted",
      submissionNumber
    );

  if (currentDraft) {
    const url =
      `${SUPABASE_URL}/rest/v1/near_misses` +
      `?id=eq.${currentDraft.id}`;

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
            JSON.stringify(saveData)
        }
      );

    if (!response.ok) {
      const errorText =
        await response.text();

      console.error(errorText);

      throw new Error(
        "ヒヤリハットを提出できませんでした"
      );
    }

    currentDraft = null;

    return;
  }

  const url =
    `${SUPABASE_URL}/rest/v1/near_misses`;

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
            "return=representation"
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
      "ヒヤリハットを提出できませんでした"
    );
  }
}

/* =========================================
   フォーム初期化
========================================= */

function resetFormForNextEntry() {
  nearMissForm.reset();

  currentDraft = null;

  siteOtherBox.classList.add(
    "hidden"
  );

  clientOtherBox.classList.add(
    "hidden"
  );

  workTypeDetailBox.classList.add(
    "hidden"
  );

  placeDetailBox.classList.add(
    "hidden"
  );

  actionDetailBox.classList.add(
    "hidden"
  );

  stateDetailBox.classList.add(
    "hidden"
  );

  measureDetailBox.classList.add(
    "hidden"
  );

  occurredDate.value =
    formatDateForInput(
      new Date()
    );
}


/* =========================================
   一時保存ボタン
========================================= */

async function handleDraftSave() {
  if (
    loginUser?.department === "総務"
  ) {
    showMessage(
      "ヒヤリハットは現在、総務からは提出できません。",
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
      "入力内容を一時保存しますか？"
    );

  if (!confirmed) {
    return;
  }

  try {
    hideMessage();

    showLoading(
      "一時保存しています..."
    );

    await saveDraft();

    showMessage(
      "一時保存しました。",
      "success"
    );

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
   提出ボタン
========================================= */

async function handleSubmit(event) {
  event.preventDefault();

  if (
    loginUser?.department === "総務"
  ) {
    showMessage(
      "ヒヤリハットは現在、総務からは提出できません。",
      "error"
    );

    window.scrollTo({
      top: 0,
      behavior: "smooth"
    });

    return;
  }

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
      "ヒヤリハットを提出しますか？\n" +
      "提出後は本人も管理者も内容を変更できません。"
    );

  if (!confirmed) {
    return;
  }

  try {
    showLoading(
      "提出しています..."
    );

    await submitNearMiss();

    await loadSubmissionHistory();

    resetFormForNextEntry();

    showMessage(
      "ヒヤリハットを提出しました。" +
      "続けてもう1件入力できます。",
      "success"
    );

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

async function initializeNearMissPage() {
  try {
    showLoading(
      "ヒヤリハットを読み込んでいます..."
    );

    loginUser =
      getLoginUser();

    if (!loginUser) {
      window.location.href =
        "login.html";

      return;
    }

    targetMonth =
  getTargetMonthFromOccurredDate(
    formatDateForInput(
      new Date()
    )
  );

    createFixedOptions();

    await loadSites();

    displayInitialData();

    await loadCurrentDraft();

    await loadSubmissionHistory();

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

occurredDate.addEventListener(
  "change",
  () => {
    targetMonth =
      getTargetMonthFromOccurredDate(
        occurredDate.value
      );

    targetMonthDisplay.textContent =
      formatTargetMonthLabel(
        targetMonth
      );
  }
);

siteSelect.addEventListener(
  "change",
  handleSiteChange
);

clientSelect.addEventListener(
  "change",
  handleClientChange
);

workTypeSelect.addEventListener(
  "change",
  () => {
    toggleOtherDetail(
      workTypeSelect,
      workTypeDetailBox,
      workTypeDetail
    );
  }
);

placeTypeSelect.addEventListener(
  "change",
  () => {
    toggleOtherDetail(
      placeTypeSelect,
      placeDetailBox,
      placeDetail
    );
  }
);

actionTypeSelect.addEventListener(
  "change",
  handleActionTypeChange
);

stateTypeSelect.addEventListener(
  "change",
  () => {
    toggleOtherDetail(
      stateTypeSelect,
      stateDetailBox,
      stateDetail
    );
  }
);

measureTypeSelect.addEventListener(
  "change",
  () => {
    toggleOtherDetail(
      measureTypeSelect,
      measureDetailBox,
      measureDetail
    );
  }
);

draftButton.addEventListener(
  "click",
  handleDraftSave
);

nearMissForm.addEventListener(
  "submit",
  handleSubmit
);


/* =========================================
   実行
========================================= */

initializeNearMissPage();