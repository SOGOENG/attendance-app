/* =========================================
   Supabase
========================================= */

const SUPABASE_URL =
  "https://fgmvmbjnoyagnpygcbky.supabase.co";


/* =========================================
   HTML要素
========================================= */

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

const detailAssignedEmployee =
  document.getElementById(
    "detailAssignedEmployee"
  );

const detailStatus =
  document.getElementById(
    "detailStatus"
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


/* =========================================
   データ
========================================= */

let currentTool = null;

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

function escapeHtml(value) {
  return String(value ?? "")
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

  return params.get("id");
}


/* =========================================
   社員名分解
========================================= */

function splitEmployeeName(
  fullName
) {
  const normalized =
    String(fullName || "")
      .trim()
      .replace(/\u3000/g, " ")
      .replace(/\s+/g, " ");

  if (!normalized) {
    return {
      familyName: "",
      givenName: ""
    };
  }

  const parts =
    normalized.split(" ");

  if (parts.length >= 2) {
    return {
      familyName:
        parts[0],

      givenName:
        parts.slice(1).join("")
    };
  }

  /*
    スペースなしの場合は
    姓名を安全に判定できないため
    元の名前をそのまま姓扱い
  */

  return {
    familyName:
      normalized,

    givenName:
      ""
  };
}


/* =========================================
   表示用社員名作成

   通常：
   鈴木 和弘 → 鈴木

   同姓あり：
   鈴木 和弘 → 鈴木和
   鈴木 一郎 → 鈴木一
========================================= */

function buildEmployeeDisplayNames() {
  employeeDisplayNameMap.clear();

  const familyNameCount =
    new Map();


  /*
    苗字ごとの人数を数える
  */

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


  /*
    表示名を作成
  */

  employeeRecords.forEach(
    employee => {

      const name =
        splitEmployeeName(
          employee.name
        );

      if (!name.familyName) {
        employeeDisplayNameMap.set(
          String(employee.id),
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


      /*
        同姓が複数いる場合だけ
        名前の最初の1文字を付ける
      */

      if (
        count >= 2 &&
        name.givenName
      ) {
        displayName +=
          name.givenName.charAt(0);
      }

      employeeDisplayNameMap.set(
        String(employee.id),
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
      String(employeeId)
    ) ||
    employeeNameMap.get(
      String(employeeId)
    ) ||
    "-"
  );
}


/* =========================================
   状態表示
========================================= */

function formatToolStatus(status) {
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
   日時表示
========================================= */

function formatDateTime(
  value
) {
  if (!value) {
    return "-";
  }

  const date =
    new Date(value);

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
   現場読込
========================================= */

async function loadSites() {
  const url =
    `${SUPABASE_URL}/rest/v1/sites` +
    `?select=id,display_name`;

  const response =
    await portalFetch(url);

  if (!response.ok) {
    const errorText =
      await response.text();

    console.error(
      errorText
    );

    throw new Error(
      "現場情報を読み込めませんでした"
    );
  }

  const sites =
    await response.json();

  siteNameMap.clear();

  sites.forEach(site => {
    siteNameMap.set(
      String(site.id),
      site.display_name
    );
  });
}


/* =========================================
   社員読込
========================================= */

async function loadEmployees() {
  const url =
    `${SUPABASE_URL}/rest/v1/employees` +
    `?select=id,name`;

  const response =
    await portalFetch(url);

  if (!response.ok) {
    const errorText =
      await response.text();

    console.error(
      errorText
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
        String(employee.id),
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
    await portalFetch(url);

  if (!response.ok) {
    const errorText =
      await response.text();

    console.error(
      errorText
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
}


/* =========================================
   操作ボタン
========================================= */

function displayActionButtons() {
  detailActionButtons.innerHTML =
    "";

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
   最新点検履歴
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
    await portalFetch(url);

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
   履歴読込
========================================= */

async function loadHistory() {
  const url =
    `${SUPABASE_URL}/rest/v1/tool_history` +
    `?tool_id=eq.${currentTool.id}` +
    `&select=*` +
    `&order=created_at.desc`;

  const response =
    await portalFetch(url);

  if (!response.ok) {
    const errorText =
      await response.text();

    console.error(
      errorText
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
   履歴表示
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


      /*
        現場
      */

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


      /*
        担当者
      */

      const fromEmployee =
        getEmployeeDisplayName(
          history.from_employee_id
        );

      const toEmployee =
        getEmployeeDisplayName(
          history.to_employee_id
        );


      /*
        操作者
      */

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

    displayTool();

    displayActionButtons();

    await Promise.all([
      loadLatestInspection(),
      loadHistory()
    ]);

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