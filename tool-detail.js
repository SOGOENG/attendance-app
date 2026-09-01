/* =========================================
   Supabase
========================================= */

const SUPABASE_URL =
  "https://fgmvmbjnoyagnpygcbky.supabase.co";


/* =========================================
   HTML要素
========================================= */

const detailBackButton =
  document.getElementById(
    "detailBackButton"
  );

const detailToolTitle =
  document.getElementById(
    "detailToolTitle"
  );

const detailToolGroup =
  document.getElementById(
    "detailToolGroup"
  );

const detailManagementCode =
  document.getElementById(
    "detailManagementCode"
  );

const detailSpecification =
  document.getElementById(
    "detailSpecification"
  );

const detailManufacturer =
  document.getElementById(
    "detailManufacturer"
  );

const detailModelNumber =
  document.getElementById(
    "detailModelNumber"
  );

const detailSerialNumber =
  document.getElementById(
    "detailSerialNumber"
  );

const detailPerformance =
  document.getElementById(
    "detailPerformance"
  );

const detailCurrentSite =
  document.getElementById(
    "detailCurrentSite"
  );

const detailCurrentSiteRow =
  document.getElementById(
    "detailCurrentSiteRow"
  );

const detailAssignedEmployee =
  document.getElementById(
    "detailAssignedEmployee"
  );

const detailStatus =
  document.getElementById(
    "detailStatus"
  );

const detailStatusRow =
  document.getElementById(
    "detailStatusRow"
  );

const detailNote =
  document.getElementById(
    "detailNote"
  );

const detailInspectionRequired =
  document.getElementById(
    "detailInspectionRequired"
  );

const detailInspectionCategory =
  document.getElementById(
    "detailInspectionCategory"
  );

const detailLastInspectionDate =
  document.getElementById(
    "detailLastInspectionDate"
  );

const detailStickerNumber =
  document.getElementById(
    "detailStickerNumber"
  );

const detailActionSection =
  document.getElementById(
    "detailActionSection"
  );

const detailActionButtons =
  document.getElementById(
    "detailActionButtons"
  );

const toolHistoryList =
  document.getElementById(
    "toolHistoryList"
  );

const toolDetailMessage =
  document.getElementById(
    "toolDetailMessage"
  );

const showToolQrButton =
  document.getElementById(
    "showToolQrButton"
  );

const toolQrDisplay =
  document.getElementById(
    "toolQrDisplay"
  );

const toolQrCode =
  document.getElementById(
    "toolQrCode"
  );

const toolQrUrl =
  document.getElementById(
    "toolQrUrl"
  );


/* =========================================
   バッテリー管理
========================================= */

const batteryManagementSection =
  document.getElementById(
    "batteryManagementSection"
  );

const detailLastBatteryReplacementDate =
  document.getElementById(
    "detailLastBatteryReplacementDate"
  );

const openBatteryHistoryFormButton =
  document.getElementById(
    "openBatteryHistoryFormButton"
  );

const batteryHistoryForm =
  document.getElementById(
    "batteryHistoryForm"
  );

const batteryReplacementDate =
  document.getElementById(
    "batteryReplacementDate"
  );

const batteryModel =
  document.getElementById(
    "batteryModel"
  );

const batteryReplacementReason =
  document.getElementById(
    "batteryReplacementReason"
  );

const batteryReplacementNote =
  document.getElementById(
    "batteryReplacementNote"
  );

const saveBatteryHistoryButton =
  document.getElementById(
    "saveBatteryHistoryButton"
  );

const cancelBatteryHistoryButton =
  document.getElementById(
    "cancelBatteryHistoryButton"
  );

const batteryHistoryMessage =
  document.getElementById(
    "batteryHistoryMessage"
  );

const batteryHistoryList =
  document.getElementById(
    "batteryHistoryList"
  );


/* =========================================
   データ
========================================= */

let currentTool = null;


/* =========================================
   QRコード
========================================= */

function createToolDetailUrl(
  toolId
) {

  const url =
    new URL(
      "tool-detail.html",
      window.location.href
    );


  url.searchParams.set(
    "id",
    toolId
  );


  return url.href;
}


function createToolDetailQrCode(
  container,
  toolId,
  size = 113
) {

  if (
    typeof QRCode ===
    "undefined"
  ) {

    throw new Error(
      "QRコード生成機能を読み込めませんでした"
    );
  }


  const detailUrl =
    createToolDetailUrl(
      toolId
    );


  container.innerHTML =
    "";


  new QRCode(
    container,
    {
      text:
        detailUrl,

      width:
        size,

      height:
        size,

      correctLevel:
        QRCode.CorrectLevel.M
    }
  );


  return detailUrl;
}


function showToolQrCode() {

  if (!currentTool) {
    return;
  }


  try {

    const detailUrl =
      createToolDetailQrCode(
        toolQrCode,
        currentTool.id
      );


    toolQrUrl.textContent =
      detailUrl;


    toolQrDisplay.hidden =
      false;

  } catch (error) {

    console.error(
      error
    );


    toolDetailMessage.textContent =
      error.message;
  }
}

let employeeRecords = [];

const siteNameMap =
  new Map();

const employeeNameMap =
  new Map();

const employeeDisplayNameMap =
  new Map();


/* =========================================
   共通
========================================= */

function escapeHtml(
  value
) {

  return String(
    value ?? ""
  )
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}


function getToolIdFromUrl() {

  const params =
    new URLSearchParams(
      window.location.search
    );

  return params.get(
    "id"
  );
}


/* =========================================
   社員名分解
========================================= */

function splitEmployeeName(
  fullName
) {

  const normalized =
    String(
      fullName || ""
    )
      .trim()
      .replace(
        /\u3000/g,
        " "
      )
      .replace(
        /\s+/g,
        " "
      );


  if (!normalized) {

    return {
      familyName: "",
      givenName: ""
    };
  }


  const parts =
    normalized.split(
      " "
    );


  if (
    parts.length >= 2
  ) {

    return {

      familyName:
        parts[0],

      givenName:
        parts
          .slice(1)
          .join("")
    };
  }


  return {

    familyName:
      normalized,

    givenName:
      ""
  };
}


/* =========================================
   表示用社員名作成
========================================= */

function buildEmployeeDisplayNames() {

  employeeDisplayNameMap.clear();


  const familyNameCount =
    new Map();


  employeeRecords.forEach(
    employee => {

      const name =
        splitEmployeeName(
          employee.name
        );


      if (!name.familyName) {
        return;
      }


      const currentCount =
        familyNameCount.get(
          name.familyName
        ) || 0;


      familyNameCount.set(
        name.familyName,
        currentCount + 1
      );
    }
  );


  employeeRecords.forEach(
    employee => {

      const name =
        splitEmployeeName(
          employee.name
        );


      if (!name.familyName) {

        employeeDisplayNameMap.set(
          String(
            employee.id
          ),
          "-"
        );

        return;
      }


      const count =
        familyNameCount.get(
          name.familyName
        ) || 0;


      let displayName =
        name.familyName;


      if (
        count >= 2 &&
        name.givenName
      ) {

        displayName +=
          name.givenName.charAt(
            0
          );
      }


      employeeDisplayNameMap.set(
        String(
          employee.id
        ),
        displayName
      );
    }
  );
}


/* =========================================
   社員表示名取得
========================================= */

function getEmployeeDisplayName(
  employeeId
) {

  if (!employeeId) {
    return "-";
  }


  return (
    employeeDisplayNameMap.get(
      String(
        employeeId
      )
    ) ||
    employeeNameMap.get(
      String(
        employeeId
      )
    ) ||
    "-"
  );
}


/* =========================================
   状態
========================================= */

function formatToolStatus(
  status
) {

  switch (status) {

    case "available":
      return "貸出可";

    case "in_use":
      return "使用中";

    case "repair":
      return "修理中";

    case "stopped":
      return "使用停止";

    case "disposed":
      return "廃棄";

    default:
      return status || "-";
  }
}


/* =========================================
   点検区分
========================================= */

function formatInspectionCategory(
  category
) {

  switch (category) {

    case "3p":
      return "3P工具";

    case "double_insulated":
      return "二重絶縁工具";

    case "battery":
      return "充電式工具";

    case "cord_reel":
      return "コードリール";

    case "ac_welder":
      return "交流式溶接機";

    case "dc_welder":
      return "直流式溶接機";

    default:
      return "-";
  }
}


/* =========================================
   履歴種別
========================================= */

function formatHistoryAction(
  actionType
) {

  switch (actionType) {

    case "checkout":
      return "持出";

    case "move":
      return "移動";

    case "return":
      return "返却";

    case "assign":
      return "担当変更";

    case "repair":
      return "修理";

    case "stop":
      return "使用停止";

    case "resume":
      return "使用再開";

    case "dispose":
      return "廃棄";

    default:
      return actionType || "-";
  }
}


/* =========================================
   日時
========================================= */

function formatDateTime(
  value
) {

  if (!value) {
    return "-";
  }


  const date =
    new Date(
      value
    );


  return date.toLocaleString(
    "ja-JP",
    {

      year:
        "numeric",

      month:
        "2-digit",

      day:
        "2-digit",

      hour:
        "2-digit",

      minute:
        "2-digit"
    }
  );
}


/* =========================================
   日付
========================================= */

function formatDate(
  value
) {

  if (!value) {
    return "-";
  }


  const parts =
    String(
      value
    ).split(
      "-"
    );


  if (
    parts.length !== 3
  ) {

    return value;
  }


  return (
    `${parts[0]}/` +
    `${parts[1]}/` +
    `${parts[2]}`
  );
}


/* =========================================
   今日の日付
========================================= */

function getTodayDateString() {

  const today =
    new Date();


  const year =
    today.getFullYear();


  const month =
    String(
      today.getMonth() + 1
    ).padStart(
      2,
      "0"
    );


  const day =
    String(
      today.getDate()
    ).padStart(
      2,
      "0"
    );


  return (
    `${year}-${month}-${day}`
  );
}


/* =========================================
   現場読込
========================================= */

async function loadSites() {

  const url =
    `${SUPABASE_URL}/rest/v1/sites` +
    `?select=id,display_name`;


  const response =
    await portalFetch(
      url
    );


  if (!response.ok) {

    console.error(
      await response.text()
    );


    throw new Error(
      "現場情報を読み込めませんでした"
    );
  }


  const sites =
    await response.json();


  siteNameMap.clear();


  sites.forEach(
    site => {

      siteNameMap.set(
        String(
          site.id
        ),
        site.display_name
      );
    }
  );
}


/* =========================================
   社員読込
========================================= */

async function loadEmployees() {

  const url =
    `${SUPABASE_URL}/rest/v1/employees` +
    `?select=id,name`;


  const response =
    await portalFetch(
      url
    );


  if (!response.ok) {

    console.error(
      await response.text()
    );


    throw new Error(
      "社員情報を読み込めませんでした"
    );
  }


  employeeRecords =
    await response.json();


  employeeNameMap.clear();


  employeeRecords.forEach(
    employee => {

      employeeNameMap.set(
        String(
          employee.id
        ),
        employee.name
      );
    }
  );


  buildEmployeeDisplayNames();
}


/* =========================================
   工具読込
========================================= */

async function loadTool() {

  const toolId =
    getToolIdFromUrl();


  if (!toolId) {

    throw new Error(
      "工具IDがありません"
    );
  }


  const url =
    `${SUPABASE_URL}/rest/v1/tools` +
    `?id=eq.${toolId}` +
    `&select=*`;


  const response =
    await portalFetch(
      url
    );


  if (!response.ok) {

    console.error(
      await response.text()
    );


    throw new Error(
      "工具情報を読み込めませんでした"
    );
  }


  const tools =
    await response.json();


  if (
    tools.length === 0
  ) {

    throw new Error(
      "工具が見つかりません"
    );
  }


  currentTool =
    tools[0];
}


/* =========================================
   所有区分による詳細表示
========================================= */

function updateDetailByOwnership() {

  const isPersonal =
    currentTool.ownership_type ===
    "personal";


  /*
    個人工具
  */

  if (isPersonal) {

    detailCurrentSiteRow.style.display =
      "none";


    detailStatusRow.style.display =
      "none";


    detailActionSection.style.display =
      "none";


    /*
      戻る先も個人工具へ
    */

    detailBackButton.href =
      "personal-tools.html";


    detailBackButton.textContent =
      "個人工具へ戻る";


    return;
  }


  /*
    共有・その他
  */

  detailCurrentSiteRow.style.display =
    "";


  detailStatusRow.style.display =
    "";


  detailActionSection.style.display =
    "";


  detailBackButton.href =
    "shared-tools.html";


  detailBackButton.textContent =
    "共有工具へ戻る";
}


/* =========================================
   基本情報表示
========================================= */

function displayTool() {

  detailToolTitle.textContent =
    `${currentTool.tool_name}` +
    `${
      currentTool.specification
        ? ` ${currentTool.specification}`
        : ""
    }`;


  detailToolGroup.textContent =
    currentTool.tool_group ||
    "未設定";


  detailManagementCode.textContent =
    currentTool.management_code ||
    "-";


  detailSpecification.textContent =
    currentTool.specification ||
    "-";


  detailManufacturer.textContent =
    currentTool.manufacturer ||
    "-";


  detailModelNumber.textContent =
    currentTool.model_number ||
    "-";


  detailSerialNumber.textContent =
    currentTool.serial_number ||
    "-";


  detailPerformance.textContent =
    currentTool.performance ||
    "-";


  detailCurrentSite.textContent =
    currentTool.current_site_id
      ? (
          siteNameMap.get(
            String(
              currentTool.current_site_id
            )
          ) || "-"
        )
      : "倉庫";


  detailAssignedEmployee.textContent =
    getEmployeeDisplayName(
      currentTool.assigned_employee_id
    );


  detailStatus.textContent =
    formatToolStatus(
      currentTool.status
    );


  detailNote.textContent =
    currentTool.note ||
    "-";


  detailInspectionRequired.textContent =
    currentTool.inspection_required
      ? "対象"
      : "対象外";


  detailInspectionCategory.textContent =
    currentTool.inspection_required
      ? formatInspectionCategory(
          currentTool.inspection_category
        )
      : "-";


  updateDetailByOwnership();
}


/* =========================================
   操作ボタン
========================================= */

function displayActionButtons() {

  detailActionButtons.innerHTML =
    "";


  /*
    個人工具は操作なし
  */

  if (
    currentTool.ownership_type ===
    "personal"
  ) {

    return;
  }


  /*
    持出管理対象外も操作なし
  */

  if (
    currentTool.checkout_managed ===
    false
  ) {

    return;
  }


  if (
    currentTool.status ===
    "available"
  ) {

    detailActionButtons.innerHTML =
      `
        <a
          href="tool-checkout.html?id=${currentTool.id}"
          class="admin-primary-button"
        >
          持出
        </a>
      `;

    return;
  }


  if (
    currentTool.status ===
    "in_use"
  ) {

    detailActionButtons.innerHTML =
      `
        <a
          href="tool-move.html?id=${currentTool.id}"
          class="admin-secondary-button"
        >
          移動
        </a>

        <a
          href="shared-tools.html"
          class="admin-primary-button"
        >
          共有工具画面へ戻る
        </a>
      `;

    return;
  }


  detailActionButtons.innerHTML =
    `
      <p class="schedule-empty-message">
        現在操作できません
      </p>
    `;
}


/* =========================================
   最新点検
========================================= */

async function loadLatestInspection() {

  if (
    !currentTool.inspection_required
  ) {

    detailLastInspectionDate.textContent =
      "対象外";


    detailStickerNumber.textContent =
      "対象外";


    return;
  }


  const url =
    `${SUPABASE_URL}/rest/v1/tool_inspections` +
    `?tool_id=eq.${currentTool.id}` +
    `&select=inspection_date,sticker_number` +
    `&order=inspection_date.desc` +
    `&limit=1`;


  const response =
    await portalFetch(
      url
    );


  if (!response.ok) {

    console.error(
      await response.text()
    );


    detailLastInspectionDate.textContent =
      "未登録";


    detailStickerNumber.textContent =
      "未登録";


    return;
  }


  const records =
    await response.json();


  if (
    records.length === 0
  ) {

    detailLastInspectionDate.textContent =
      "未登録";


    detailStickerNumber.textContent =
      "未登録";


    return;
  }


  detailLastInspectionDate.textContent =
    records[0].inspection_date ||
    "未登録";


  detailStickerNumber.textContent =
    records[0].sticker_number ||
    "未登録";
}


/* =========================================
   バッテリー管理表示
========================================= */

function setupBatteryManagement() {

  const isBatteryTool =
    currentTool.tool_group ===
    "充電工具";


  if (!isBatteryTool) {

    batteryManagementSection.style.display =
      "none";

    return;
  }


  batteryManagementSection.style.display =
    "block";


  batteryReplacementDate.value =
    getTodayDateString();
}


/* =========================================
   バッテリー登録フォーム
========================================= */

function openBatteryForm() {

  batteryHistoryMessage.textContent =
    "";


  batteryReplacementDate.value =
    getTodayDateString();


  batteryModel.value =
    "";


  batteryReplacementReason.value =
    "";


  batteryReplacementNote.value =
    "";


  batteryHistoryForm.style.display =
    "block";


  batteryHistoryForm.scrollIntoView({
    behavior: "smooth",
    block: "nearest"
  });
}


function closeBatteryForm() {

  batteryHistoryForm.style.display =
    "none";


  batteryHistoryMessage.textContent =
    "";
}


/* =========================================
   バッテリー交換登録
========================================= */

async function saveBatteryHistory() {

  batteryHistoryMessage.textContent =
    "";


  if (
    !batteryReplacementDate.value
  ) {

    batteryHistoryMessage.textContent =
      "交換日を入力してください";

    return;
  }


  const confirmed =
    window.confirm(
      "バッテリー交換履歴を登録しますか？"
    );


  if (!confirmed) {
    return;
  }


  const record = {

    tool_id:
      Number(
        currentTool.id
      ),

    replacement_date:
      batteryReplacementDate.value,

    battery_model:
      batteryModel.value
        .trim() ||
      null,

    reason:
      batteryReplacementReason.value
        .trim() ||
      null,

    note:
      batteryReplacementNote.value
        .trim() ||
      null
  };


  try {

    const response =
      await portalFetch(
        `${SUPABASE_URL}/rest/v1/tool_battery_history`,
        {

          method:
            "POST",

          headers: {

            "Content-Type":
              "application/json",

            Prefer:
              "return=minimal"
          },

          body:
            JSON.stringify(
              record
            )
        }
      );


    if (!response.ok) {

      console.error(
        await response.text()
      );


      throw new Error(
        "バッテリー交換履歴を登録できませんでした"
      );
    }


    closeBatteryForm();


    await loadBatteryHistory();


    alert(
      "バッテリー交換履歴を登録しました"
    );


  } catch (error) {

    console.error(
      error
    );


    batteryHistoryMessage.textContent =
      error.message;
  }
}


/* =========================================
   バッテリー履歴読込
========================================= */

async function loadBatteryHistory() {

  if (
    currentTool.tool_group !==
    "充電工具"
  ) {

    return;
  }


  const url =
    `${SUPABASE_URL}/rest/v1/tool_battery_history` +
    `?tool_id=eq.${currentTool.id}` +
    `&select=*` +
    `&order=replacement_date.desc,created_at.desc`;


  const response =
    await portalFetch(
      url
    );


  if (!response.ok) {

    console.error(
      await response.text()
    );


    batteryHistoryList.innerHTML =
      `
        <p class="schedule-empty-message">
          バッテリー履歴を読み込めませんでした
        </p>
      `;


    detailLastBatteryReplacementDate.textContent =
      "未登録";


    return;
  }


  const histories =
    await response.json();


  displayBatteryHistory(
    histories
  );
}


/* =========================================
   バッテリー履歴表示
========================================= */

function displayBatteryHistory(
  histories
) {

  batteryHistoryList.innerHTML =
    "";


  if (
    histories.length === 0
  ) {

    detailLastBatteryReplacementDate.textContent =
      "未登録";


    batteryHistoryList.innerHTML =
      `
        <p class="schedule-empty-message">
          交換履歴はありません
        </p>
      `;


    return;
  }


  detailLastBatteryReplacementDate.textContent =
    formatDate(
      histories[0].replacement_date
    );


  histories.forEach(
    history => {

      const item =
        document.createElement(
          "div"
        );


      item.className =
        "tool-history-item";


      item.innerHTML =
        `
          <p>
            <strong>
              交換日：
              ${escapeHtml(
                formatDate(
                  history.replacement_date
                )
              )}
            </strong>
          </p>

          <p>
            バッテリー型式：
            ${escapeHtml(
              history.battery_model ||
              "-"
            )}
          </p>

          <p>
            交換理由：
            ${escapeHtml(
              history.reason ||
              "-"
            )}
          </p>

          ${
            history.note
              ? `
                <p>
                  備考：
                  ${escapeHtml(
                    history.note
                  )}
                </p>
              `
              : ""
          }
        `;


      batteryHistoryList.appendChild(
        item
      );
    }
  );
}


/* =========================================
   通常履歴読込
========================================= */

async function loadHistory() {

  const url =
    `${SUPABASE_URL}/rest/v1/tool_history` +
    `?tool_id=eq.${currentTool.id}` +
    `&select=*` +
    `&order=created_at.desc`;


  const response =
    await portalFetch(
      url
    );


  if (!response.ok) {

    console.error(
      await response.text()
    );


    throw new Error(
      "履歴を読み込めませんでした"
    );
  }


  const histories =
    await response.json();


  displayHistory(
    histories
  );
}


/* =========================================
   通常履歴表示
========================================= */

function displayHistory(
  histories
) {

  toolHistoryList.innerHTML =
    "";


  if (
    histories.length === 0
  ) {

    toolHistoryList.innerHTML =
      `
        <p class="schedule-empty-message">
          履歴はありません
        </p>
      `;

    return;
  }


  histories.forEach(
    history => {

      const item =
        document.createElement(
          "div"
        );


      item.className =
        "tool-history-item";


      const fromSite =
        history.from_site_id
          ? (
              siteNameMap.get(
                String(
                  history.from_site_id
                )
              ) || "-"
            )
          : "倉庫";


      const toSite =
        history.to_site_id
          ? (
              siteNameMap.get(
                String(
                  history.to_site_id
                )
              ) || "-"
            )
          : "倉庫";


      const fromEmployee =
        getEmployeeDisplayName(
          history.from_employee_id
        );


      const toEmployee =
        getEmployeeDisplayName(
          history.to_employee_id
        );


      const operator =
        getEmployeeDisplayName(
          history.operated_by_employee_id
        );


      item.innerHTML =
        `
          <p>
            <strong>
              ${escapeHtml(
                formatDateTime(
                  history.created_at
                )
              )}
              　
              ${escapeHtml(
                formatHistoryAction(
                  history.action_type
                )
              )}
            </strong>
          </p>

          <p>
            現在地：
            ${escapeHtml(
              fromSite
            )}
            →
            ${escapeHtml(
              toSite
            )}
          </p>

          <p>
            担当：
            ${escapeHtml(
              fromEmployee
            )}
            →
            ${escapeHtml(
              toEmployee
            )}
          </p>

          <p>
            操作者：
            ${escapeHtml(
              operator
            )}
          </p>

          ${
            history.note
              ? `
                <p>
                  備考：
                  ${escapeHtml(
                    history.note
                  )}
                </p>
              `
              : ""
          }
        `;


      toolHistoryList.appendChild(
        item
      );
    }
  );
}


/* =========================================
   バッテリーイベント
========================================= */

openBatteryHistoryFormButton
  .addEventListener(
    "click",
    openBatteryForm
  );


cancelBatteryHistoryButton
  .addEventListener(
    "click",
    closeBatteryForm
  );


saveBatteryHistoryButton
  .addEventListener(
    "click",
    saveBatteryHistory
  );


showToolQrButton
  .addEventListener(
    "click",
    showToolQrCode
  );


/* =========================================
   初期化
========================================= */

async function initialize() {

  toolDetailMessage.textContent =
    "";


  try {

    await Promise.all([
      loadSites(),
      loadEmployees()
    ]);


    await loadTool();


    showToolQrButton.disabled =
      false;


    displayTool();


    displayActionButtons();


    setupBatteryManagement();


    const jobs = [
      loadLatestInspection(),
      loadHistory()
    ];


    if (
      currentTool.tool_group ===
      "充電工具"
    ) {

      jobs.push(
        loadBatteryHistory()
      );
    }


    await Promise.all(
      jobs
    );


  } catch (error) {

    console.error(
      error
    );


    toolDetailMessage.textContent =
      error.message;


    toolHistoryList.innerHTML =
      `
        <p class="schedule-empty-message">
          読み込みに失敗しました
        </p>
      `;
  }
}


initialize();
