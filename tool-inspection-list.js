/* =========================================
   Supabase
========================================= */

const SUPABASE_URL =
  "https://fgmvmbjnoyagnpygcbky.supabase.co";


/* =========================================
   HTML要素
========================================= */

const inspectionListCycleName =
  document.getElementById(
    "inspectionListCycleName"
  );

const inspectionListCycleStatus =
  document.getElementById(
    "inspectionListCycleStatus"
  );

const inspectionListStartSticker =
  document.getElementById(
    "inspectionListStartSticker"
  );

const inspectionListNextSticker =
  document.getElementById(
    "inspectionListNextSticker"
  );

const inspectionTargetCount =
  document.getElementById(
    "inspectionTargetCount"
  );

const inspectionCompletedCount =
  document.getElementById(
    "inspectionCompletedCount"
  );

const inspectionPendingCount =
  document.getElementById(
    "inspectionPendingCount"
  );


/* =========================================
   点検工具検索
========================================= */

const inspectionGroupFilter =
  document.getElementById(
    "inspectionGroupFilter"
  );

const inspectionToolNameFilter =
  document.getElementById(
    "inspectionToolNameFilter"
  );

const inspectionStatusFilter =
  document.getElementById(
    "inspectionStatusFilter"
  );

const inspectionSearchButton =
  document.getElementById(
    "inspectionSearchButton"
  );

const inspectionToolResultSection =
  document.getElementById(
    "inspectionToolResultSection"
  );

const inspectionToolResultTitle =
  document.getElementById(
    "inspectionToolResultTitle"
  );

const inspectionToolResultCount =
  document.getElementById(
    "inspectionToolResultCount"
  );

const inspectionToolResultClose =
  document.getElementById(
    "inspectionToolResultClose"
  );

const inspectionToolList =
  document.getElementById(
    "inspectionToolList"
  );

const inspectionListMessage =
  document.getElementById(
    "inspectionListMessage"
  );

const inspectionQrStartButton =
  document.getElementById(
    "inspectionQrStartButton"
  );

const inspectionQrPanel =
  document.getElementById(
    "inspectionQrPanel"
  );

const inspectionQrCancelButton =
  document.getElementById(
    "inspectionQrCancelButton"
  );

const inspectionQrMessage =
  document.getElementById(
    "inspectionQrMessage"
  );

const inspectionQrResultLink =
  document.getElementById(
    "inspectionQrResultLink"
  );


/* =========================================
   CSV出力
========================================= */

const openInspectionCsvSettingsButton =
  document.getElementById(
    "openInspectionCsvSettingsButton"
  );

const inspectionCsvSettingsPanel =
  document.getElementById(
    "inspectionCsvSettingsPanel"
  );

const inspectionCsvExportStatus =
  document.getElementById(
    "inspectionCsvExportStatus"
  );

const inspectionCsvOwnershipFilter =
  document.getElementById(
    "inspectionCsvOwnershipFilter"
  );

const inspectionCsvSiteFilter =
  document.getElementById(
    "inspectionCsvSiteFilter"
  );

const inspectionCsvEmployeeFilter =
  document.getElementById(
    "inspectionCsvEmployeeFilter"
  );

const inspectionCsvContractorFilter =
  document.getElementById(
    "inspectionCsvContractorFilter"
  );

const inspectionCsvGroupFilter =
  document.getElementById(
    "inspectionCsvGroupFilter"
  );

const inspectionCsvToolNameFilter =
  document.getElementById(
    "inspectionCsvToolNameFilter"
  );

const inspectionCsvTargetCount =
  document.getElementById(
    "inspectionCsvTargetCount"
  );

const inspectionCsvExportButton =
  document.getElementById(
    "inspectionCsvExportButton"
  );

const inspectionCsvResetExportedButton =
  document.getElementById(
    "inspectionCsvResetExportedButton"
  );

const closeInspectionCsvSettingsButton =
  document.getElementById(
    "closeInspectionCsvSettingsButton"
  );

const inspectionCsvMessage =
  document.getElementById(
    "inspectionCsvMessage"
  );


/* =========================================
   データ
========================================= */

let currentCycle =
  null;

let inspectionTools =
  [];

let inspectionRecords =
  [];

let employees =
  [];

let sites =
  [];

const inspectedToolIdSet =
  new Set();

const employeeNameMap =
  new Map();

const siteNameMap =
  new Map();

let inspectionQrScanner =
  null;

let inspectionQrScanning =
  false;

let inspectionQrProcessing =
  false;

let inspectionQrSessionId =
  0;


/* =========================================
   QRコード読取
========================================= */

function getToolIdFromQrText(
  decodedText
) {

  let url;


  try {

    url =
      new URL(
        decodedText,
        window.location.href
      );

  } catch (error) {

    return null;
  }


  if (
    !url.pathname.endsWith(
      "/tool-detail.html"
    )
  ) {

    return null;
  }


  return url.searchParams.get(
    "id"
  );
}


async function stopInspectionQrReader() {

  if (!inspectionQrScanner) {
    return;
  }


  if (!inspectionQrScanning) {
    return;
  }


  if (inspectionQrScanning) {

    try {

      await inspectionQrScanner.stop();

    } catch (error) {

      console.warn(
        error
      );
    }
  }


  inspectionQrScanning =
    false;


  try {

    inspectionQrScanner.clear();

  } catch (error) {

    console.warn(
      error
    );
  }


  inspectionQrScanner =
    null;
}


async function cancelInspectionQrReader() {

  inspectionQrSessionId +=
    1;


  await stopInspectionQrReader();


  inspectionQrProcessing =
    false;


  inspectionQrPanel.classList.add(
    "hidden"
  );


  inspectionQrStartButton.disabled =
    !currentCycle;


  inspectionQrMessage.textContent =
    "QRコードの読み取りをキャンセルしました";
}


async function loadScannedInspectionTool(
  toolId
) {

  const url =
    `${SUPABASE_URL}/rest/v1/tools` +
    `?id=eq.${encodeURIComponent(
      toolId
    )}` +
    `&select=id,inspection_required`;


  const response =
    await portalFetch(
      url
    );


  if (!response.ok) {

    throw new Error(
      "工具情報を確認できませんでした"
    );
  }


  const records =
    await response.json();


  return records[0] || null;
}


async function handleInspectionQrResult(
  decodedText
) {

  if (inspectionQrProcessing) {
    return;
  }


  const toolId =
    getToolIdFromQrText(
      decodedText
    );


  if (!toolId) {

    inspectionQrMessage.textContent =
      "工具用QRコードではありません";

    return;
  }


  inspectionQrProcessing =
    true;


  await stopInspectionQrReader();


  inspectionQrPanel.classList.add(
    "hidden"
  );


  inspectionQrMessage.textContent =
    "工具情報を確認しています…";


  try {

    const tool =
      await loadScannedInspectionTool(
        toolId
      );


    if (!tool) {

      inspectionQrMessage.textContent =
        "工具が見つかりません";

      return;
    }


    if (
      tool.inspection_required !==
      true
    ) {

      inspectionQrMessage.textContent =
        "この工具は半年点検対象ではありません";

      return;
    }


    const cycleId =
      encodeURIComponent(
        currentCycle.id
      );

    const encodedToolId =
      encodeURIComponent(
        tool.id
      );


    if (
      inspectedToolIdSet.has(
        Number(
          tool.id
        )
      )
    ) {

      inspectionQrMessage.textContent =
        "この工具は点検済みです";


      inspectionQrResultLink.href =
        `tool-inspection-result.html?cycle=${cycleId}&tool=${encodedToolId}`;


      inspectionQrResultLink.classList.remove(
        "hidden"
      );


      return;
    }


    window.location.href =
      `tool-inspection-entry.html?cycle=${cycleId}&tool=${encodedToolId}`;

  } catch (error) {

    console.error(
      error
    );


    inspectionQrMessage.textContent =
      error.message;


  } finally {

    inspectionQrProcessing =
      false;


    inspectionQrStartButton.disabled =
      false;
  }
}


function getInspectionCameraErrorMessage(
  error
) {

  const errorText =
    String(
      error?.name ||
      error?.message ||
      error ||
      ""
    ).toLowerCase();


  if (
    errorText.includes(
      "notallowed"
    ) ||
    errorText.includes(
      "permission"
    ) ||
    errorText.includes(
      "denied"
    )
  ) {

    return "カメラの使用が許可されていません。Safariの設定でカメラを許可してください";
  }


  if (!window.isSecureContext) {

    return "カメラを使用するにはHTTPSでこの画面を開いてください";
  }


  return "カメラを起動できませんでした。ほかのアプリでカメラを使用していないか確認してください";
}


async function startInspectionQrReader() {

  if (
    inspectionQrScanning ||
    inspectionQrProcessing
  ) {

    return;
  }


  if (
    typeof Html5Qrcode ===
    "undefined"
  ) {

    inspectionQrMessage.textContent =
      "QR読取機能を読み込めませんでした";

    return;
  }


  inspectionQrResultLink.classList.add(
    "hidden"
  );


  inspectionQrPanel.classList.remove(
    "hidden"
  );


  inspectionQrStartButton.disabled =
    true;


  inspectionQrMessage.textContent =
    "カメラを起動しています…";


  const sessionId =
    inspectionQrSessionId +
    1;


  inspectionQrSessionId =
    sessionId;


  let scanner =
    null;


  try {

    scanner =
      new Html5Qrcode(
        "inspectionQrReader"
      );


    inspectionQrScanner =
      scanner;


    await scanner.start(
      {
        facingMode:
          "environment"
      },
      {
        fps:
          10,

        qrbox: {
          width:
            250,

          height:
            250
        }
      },
      decodedText => {

        handleInspectionQrResult(
          decodedText
        );
      },
      () => {}
    );


    if (
      sessionId !==
      inspectionQrSessionId
    ) {

      await scanner.stop();


      scanner.clear();


      if (
        inspectionQrScanner ===
        scanner
      ) {

        inspectionQrScanner =
          null;
      }


      return;
    }


    inspectionQrScanning =
      true;


    inspectionQrMessage.textContent =
      "QRコードを枠内に合わせてください";

  } catch (error) {

    if (
      sessionId !==
      inspectionQrSessionId
    ) {

      return;
    }

    console.error(
      error
    );


    await stopInspectionQrReader();


    inspectionQrPanel.classList.add(
      "hidden"
    );


    inspectionQrMessage.textContent =
      getInspectionCameraErrorMessage(
        error
      );


    inspectionQrStartButton.disabled =
      false;
  }
}


/* =========================================
   大分類表示順
========================================= */

const TOOL_GROUP_ORDER =
  window.TOOL_GROUPS;


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


function getCycleIdFromUrl() {

  const params =
    new URLSearchParams(
      window.location.search
    );


  return params.get(
    "cycle"
  );
}


function formatCycleStatus(
  status
) {

  switch (
    status
  ) {

    case "preparing":
      return "準備中";

    case "active":
      return "点検中";

    case "completed":
      return "完了";

    default:
      return status || "-";
  }
}


function formatInspectionCategory(
  category
) {

  switch (
    category
  ) {

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


function getToolGroup(
  tool
) {

  return (
    tool.tool_group?.trim() ||
    "その他"
  );
}


function sortToolGroups(
  groups
) {

  return groups.sort(
    (a, b) => {

      const aIndex =
        TOOL_GROUP_ORDER.indexOf(
          a
        );

      const bIndex =
        TOOL_GROUP_ORDER.indexOf(
          b
        );


      if (
        aIndex !== -1 &&
        bIndex !== -1
      ) {

        return (
          aIndex -
          bIndex
        );
      }


      if (
        aIndex !== -1
      ) {

        return -1;
      }


      if (
        bIndex !== -1
      ) {

        return 1;
      }


      return a.localeCompare(
        b,
        "ja"
      );
    }
  );
}


/* =========================================
   社員名短縮
========================================= */

function splitEmployeeName(
  name
) {

  const normalized =
    String(
      name ||
      ""
    )
      .replace(
        /\u3000/g,
        " "
      )
      .trim();


  const parts =
    normalized
      .split(
        /\s+/
      )
      .filter(
        Boolean
      );


  if (
    parts.length >=
    2
  ) {

    return {

      family:
        parts[0],

      given:
        parts
          .slice(1)
          .join("")
    };
  }


  return {

    family:
      normalized,

    given:
      ""
  };
}


function getShortEmployeeName(
  employeeId
) {

  const employee =
    employees.find(
      item =>
        Number(
          item.id
        ) ===
        Number(
          employeeId
        )
    );


  if (!employee) {
    return "";
  }


  const current =
    splitEmployeeName(
      employee.name
    );


  if (
    !current.family
  ) {

    return "";
  }


  const sameFamilyCount =
    employees.filter(
      item => {

        const parsed =
          splitEmployeeName(
            item.name
          );


        return (
          parsed.family ===
          current.family
        );
      }
    ).length;


  if (
    sameFamilyCount >= 2 &&
    current.given
  ) {

    return (
      current.family +
      current.given.charAt(
        0
      )
    );
  }


  return current.family;
}


/* =========================================
   点検サイクル読込
========================================= */

async function loadCycle() {

  const cycleId =
    getCycleIdFromUrl();


  if (!cycleId) {

    throw new Error(
      "点検サイクルIDがありません"
    );
  }


  const url =
    `${SUPABASE_URL}/rest/v1/tool_inspection_cycles` +
    `?id=eq.${cycleId}` +
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
      "点検サイクルを読み込めませんでした"
    );
  }


  const records =
    await response.json();


  if (
    records.length ===
    0
  ) {

    throw new Error(
      "点検サイクルが見つかりません"
    );
  }


  currentCycle =
    records[0];


  inspectionListCycleName.textContent =
    currentCycle.cycle_name;


  inspectionListCycleStatus.textContent =
    formatCycleStatus(
      currentCycle.status
    );


  inspectionListStartSticker.textContent =
    currentCycle.start_sticker_number ??
    "-";


  inspectionListNextSticker.textContent =
    currentCycle.next_sticker_number ??
    "-";
}


/* =========================================
   点検対象工具
========================================= */

async function loadInspectionTools() {

  const url =
    `${SUPABASE_URL}/rest/v1/tools` +
    `?select=*` +
    `&inspection_required=eq.true` +
    `&status=neq.disposed` +
    `&order=tool_group.asc,tool_name.asc,management_code.asc`;


  const response =
    await portalFetch(
      url
    );


  if (!response.ok) {

    console.error(
      await response.text()
    );


    throw new Error(
      "点検対象工具を読み込めませんでした"
    );
  }


  inspectionTools =
    await response.json();
}


/* =========================================
   点検結果
========================================= */

async function loadInspectionRecords() {

  const url =
    `${SUPABASE_URL}/rest/v1/tool_inspections` +
    `?inspection_cycle=eq.${encodeURIComponent(
      currentCycle.cycle_code
    )}` +
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
      "点検履歴を読み込めませんでした"
    );
  }


  inspectionRecords =
    await response.json();


  inspectedToolIdSet.clear();


  inspectionRecords.forEach(
    record => {

      inspectedToolIdSet.add(
        Number(
          record.tool_id
        )
      );
    }
  );
}


/* =========================================
   社員
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


  employees =
    await response.json();


  employeeNameMap.clear();


  employees.forEach(
    employee => {

      employeeNameMap.set(
        Number(
          employee.id
        ),
        employee.name ||
        ""
      );
    }
  );
}


/* =========================================
   現場
========================================= */

async function loadSites() {

  const url =
    `${SUPABASE_URL}/rest/v1/sites` +
    `?select=id,display_name` +
    `&order=display_name.asc`;


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


  sites =
    await response.json();


  siteNameMap.clear();


  sites.forEach(
    site => {

      siteNameMap.set(
        Number(
          site.id
        ),
        site.display_name ||
        ""
      );
    }
  );
}


/* =========================================
   進捗
========================================= */

function updateProgress() {

  const total =
    inspectionTools.length;


  const completed =
    inspectionTools.filter(
      tool =>
        inspectedToolIdSet.has(
          Number(
            tool.id
          )
        )
    ).length;


  const pending =
    total -
    completed;


  inspectionTargetCount.textContent =
    total;


  inspectionCompletedCount.textContent =
    completed;


  inspectionPendingCount.textContent =
    pending;
}


/* =========================================
   点検検索 大分類
========================================= */

function buildGroupFilter() {

  inspectionGroupFilter.innerHTML =
    `
      <option value="">
        ---- 大分類を選択 ----
      </option>
    `;


  const groups =
    sortToolGroups(
      [
        ...new Set(
          [
            ...TOOL_GROUP_ORDER,
            ...inspectionTools.map(
              tool =>
                getToolGroup(
                  tool
                )
            )
          ]
        )
      ]
    );


  groups.forEach(
    group => {

      const option =
        document.createElement(
          "option"
        );


      option.value =
        group;


      option.textContent =
        group;


      inspectionGroupFilter
        .appendChild(
          option
        );
    }
  );
}


/* =========================================
   点検検索 工具名
========================================= */

function updateToolNameFilter() {

  const selectedGroup =
    inspectionGroupFilter.value;


  inspectionToolNameFilter.innerHTML =
    `
      <option value="">
        ---- 工具名を選択 ----
      </option>
    `;


  if (!selectedGroup) {

    inspectionToolNameFilter.disabled =
      true;

    return;
  }


  const toolNames =
    [
      ...new Set(
        inspectionTools
          .filter(
            tool =>
              getToolGroup(
                tool
              ) ===
              selectedGroup
          )
          .map(
            tool =>
              tool.tool_name
          )
          .filter(
            Boolean
          )
      )
    ].sort(
      (a, b) =>
        a.localeCompare(
          b,
          "ja"
        )
    );


  toolNames.forEach(
    toolName => {

      const option =
        document.createElement(
          "option"
        );


      option.value =
        toolName;


      option.textContent =
        toolName;


      inspectionToolNameFilter
        .appendChild(
          option
        );
    }
  );


  inspectionToolNameFilter.disabled =
    false;
}


/* =========================================
   点検工具検索
========================================= */

function searchInspectionTools() {

  const selectedGroup =
    inspectionGroupFilter.value;


  const selectedToolName =
    inspectionToolNameFilter.value;


  const selectedStatus =
    inspectionStatusFilter.value;


  if (!selectedGroup) {

    alert(
      "大分類を選択してください"
    );

    return;
  }


  if (!selectedToolName) {

    alert(
      "工具名を選択してください"
    );

    return;
  }


  const filtered =
    inspectionTools.filter(
      tool => {

        const isCompleted =
          inspectedToolIdSet.has(
            Number(
              tool.id
            )
          );


        if (
          getToolGroup(
            tool
          ) !==
          selectedGroup
        ) {

          return false;
        }


        if (
          tool.tool_name !==
          selectedToolName
        ) {

          return false;
        }


        if (
          selectedStatus ===
            "pending" &&
          isCompleted
        ) {

          return false;
        }


        if (
          selectedStatus ===
            "completed" &&
          !isCompleted
        ) {

          return false;
        }


        return true;
      }
    );


  let statusText =
    "すべて";


  if (
    selectedStatus ===
    "pending"
  ) {

    statusText =
      "未点検";
  }


  if (
    selectedStatus ===
    "completed"
  ) {

    statusText =
      "点検済み";
  }


  inspectionToolResultTitle.textContent =
    `${selectedGroup} ＞ ${selectedToolName} ＞ ${statusText}`;


  inspectionToolResultCount.textContent =
    `${filtered.length}件`;


  inspectionToolResultSection
    .classList
    .remove(
      "hidden"
    );


  displayInspectionTools(
    filtered
  );


  inspectionToolResultSection
    .scrollIntoView({
      behavior:
        "smooth",

      block:
        "start"
    });
}


/* =========================================
   工具カード
========================================= */

function displayInspectionTools(
  tools
) {

  inspectionToolList.innerHTML =
    "";


  if (
    tools.length ===
    0
  ) {

    inspectionToolList.innerHTML =
      `
        <p class="schedule-empty-message">
          該当する工具はありません
        </p>
      `;

    return;
  }


  tools.forEach(
    tool => {

      const isCompleted =
        inspectedToolIdSet.has(
          Number(
            tool.id
          )
        );


      const inspectionRecord =
        inspectionRecords.find(
          record =>
            Number(
              record.tool_id
            ) ===
            Number(
              tool.id
            )
        );


      const card =
        document.createElement(
          "article"
        );


      card.className =
        "tool-item-card";


      card.innerHTML =
        `
          <div class="tool-item-main">

            <h3>
              ${escapeHtml(
                tool.tool_name
              )}

              ${
                tool.specification
                  ? ` ${escapeHtml(
                      tool.specification
                    )}`
                  : ""
              }
            </h3>


            <p>
              管理番号：
              ${escapeHtml(
                tool.management_code
              )}
            </p>


            <p>
              点検区分：
              ${escapeHtml(
                formatInspectionCategory(
                  tool.inspection_category
                )
              )}
            </p>


            ${
              isCompleted
                ? `
                  <p>
                    状態：
                    <strong>
                      点検済み
                    </strong>
                  </p>

                  <p>
                    点検日：
                    ${escapeHtml(
                      inspectionRecord
                        ?.inspection_date ||
                      "-"
                    )}
                  </p>

                  <p>
                    シール番号：
                    ${escapeHtml(
                      inspectionRecord
                        ?.sticker_number ??
                      "-"
                    )}
                  </p>

                  <p>
                    判定：
                    <strong>
                      ${
                        inspectionRecord
                          ?.result ===
                          "ok"
                          ? "OK"
                          : "NG"
                      }
                    </strong>
                  </p>
                `
                : `
                  <p>
                    状態：
                    <strong>
                      未点検
                    </strong>
                  </p>
                `
            }

          </div>


          <div class="tool-item-actions">

            ${
              isCompleted
                ? `
                  <a
                    href="tool-inspection-result.html?cycle=${currentCycle.id}&tool=${tool.id}"
                    class="admin-secondary-button"
                  >
                    結果を見る
                  </a>
                `
                : `
                  <a
                    href="tool-inspection-entry.html?cycle=${currentCycle.id}&tool=${tool.id}"
                    class="admin-primary-button"
                  >
                    点検する
                  </a>
                `
            }

          </div>
        `;


      inspectionToolList
        .appendChild(
          card
        );
    }
  );
}


/* =========================================
   CSV共通
========================================= */

function csvEscape(
  value
) {

  const text =
    String(
      value ??
      ""
    );


  return (
    '"' +
    text.replaceAll(
      '"',
      '""'
    ) +
    '"'
  );
}


function getChecklistCsvValue(
  record,
  number
) {

  const results =
    record.checklist_results ||
    {};


  const item =
    results[
      String(number)
    ];


  if (!item) {
    return "";
  }


  /*
    初期登録データ
    {"1":"○","2":"○"}
  */

  if (
    typeof item ===
    "string"
  ) {

    return item;
  }


  /*
    今後の通常点検データ
    {
      "1": {
        checked: true,
        mark: "○"
      }
    }
  */

  if (
    item.checked !== true
  ) {

    return "";
  }


  return (
    item.mark ||
    "○"
  );
}


/* =========================================
   CSV備考
========================================= */

function buildInspectionNote(
  tool,
  record
) {

  const parts =
    [];


  /*
    シール番号
  */

  if (
    record.sticker_number !== null &&
    record.sticker_number !== undefined &&
    record.sticker_number !== ""
  ) {

    parts.push(
      `シールNo.${record.sticker_number}`
    );
  }


  /*
    協力業者だけ所有者を表示
  */

  if (
    tool.ownership_type ===
      "contractor" &&
    tool.owner_company_name
  ) {

    parts.push(
      tool.owner_company_name
    );
  }


  return parts.join(
    "　"
  );
}


/* =========================================
   CSV設定プルダウン
========================================= */

function buildCsvFilters() {

  /*
    現場
  */

  inspectionCsvSiteFilter.innerHTML =
    `
      <option value="">
        すべて
      </option>
    `;


  sites.forEach(
    site => {

      const option =
        document.createElement(
          "option"
        );


      option.value =
        site.id;


      option.textContent =
        site.display_name;


      inspectionCsvSiteFilter
        .appendChild(
          option
        );
    }
  );


  /*
    個人
  */

  inspectionCsvEmployeeFilter.innerHTML =
    `
      <option value="">
        すべて
      </option>
    `;


  const employeeIds =
    [
      ...new Set(
        inspectionTools
          .filter(
            tool =>
              tool.ownership_type ===
              "personal"
          )
          .map(
            tool =>
              tool.assigned_employee_id
          )
          .filter(
            Boolean
          )
      )
    ];


  employeeIds.forEach(
    employeeId => {

      const name =
        employeeNameMap.get(
          Number(
            employeeId
          )
        );


      if (!name) {
        return;
      }


      const option =
        document.createElement(
          "option"
        );


      option.value =
        employeeId;


      option.textContent =
        name;


      inspectionCsvEmployeeFilter
        .appendChild(
          option
        );
    }
  );


  /*
    協力業者
  */

  inspectionCsvContractorFilter.innerHTML =
    `
      <option value="">
        すべて
      </option>
    `;


  const contractors =
    [
      ...new Set(
        inspectionTools
          .filter(
            tool =>
              tool.ownership_type ===
              "contractor"
          )
          .map(
            tool =>
              tool.owner_company_name
          )
          .filter(
            Boolean
          )
      )
    ].sort(
      (a, b) =>
        a.localeCompare(
          b,
          "ja"
        )
    );


  contractors.forEach(
    contractor => {

      const option =
        document.createElement(
          "option"
        );


      option.value =
        contractor;


      option.textContent =
        contractor;


      inspectionCsvContractorFilter
        .appendChild(
          option
        );
    }
  );


  /*
    大分類
  */

  inspectionCsvGroupFilter.innerHTML =
    `
      <option value="">
        すべて
      </option>
    `;


  const groups =
    sortToolGroups(
      [
        ...new Set(
          [
            ...TOOL_GROUP_ORDER,
            ...inspectionTools.map(
              tool =>
                getToolGroup(
                  tool
                )
            )
          ]
        )
      ]
    );


  groups.forEach(
    group => {

      const option =
        document.createElement(
          "option"
        );


      option.value =
        group;


      option.textContent =
        group;


      inspectionCsvGroupFilter
        .appendChild(
          option
        );
    }
  );


  updateCsvToolNameFilter();
}


/* =========================================
   CSV 工具名
========================================= */

function updateCsvToolNameFilter() {

  const selectedGroup =
    inspectionCsvGroupFilter.value;


  inspectionCsvToolNameFilter.innerHTML =
    `
      <option value="">
        すべて
      </option>
    `;


  if (
    !selectedGroup
  ) {

    inspectionCsvToolNameFilter.disabled =
      true;

    updateCsvTargetCount();

    return;
  }


  const toolNames =
    [
      ...new Set(
        inspectionTools
          .filter(
            tool =>
              getToolGroup(
                tool
              ) ===
              selectedGroup
          )
          .map(
            tool =>
              tool.tool_name
          )
          .filter(
            Boolean
          )
      )
    ].sort(
      (a, b) =>
        a.localeCompare(
          b,
          "ja"
        )
    );


  toolNames.forEach(
    toolName => {

      const option =
        document.createElement(
          "option"
        );


      option.value =
        toolName;


      option.textContent =
        toolName;


      inspectionCsvToolNameFilter
        .appendChild(
          option
        );
    }
  );


  inspectionCsvToolNameFilter.disabled =
    false;


  updateCsvTargetCount();
}


/* =========================================
   CSV対象取得
========================================= */

function getCsvTargetItems(
  options = {}
) {

  const ignoreExportStatus =
    options.ignoreExportStatus ===
    true;


  const exportStatus =
    inspectionCsvExportStatus.value;


  const ownership =
    inspectionCsvOwnershipFilter.value;


  const siteId =
    inspectionCsvSiteFilter.value;


  const employeeId =
    inspectionCsvEmployeeFilter.value;


  const contractor =
    inspectionCsvContractorFilter.value;


  const group =
    inspectionCsvGroupFilter.value;


  const toolName =
    inspectionCsvToolNameFilter.value;


  const items =
    [];


  inspectionRecords.forEach(
    record => {

      const tool =
        inspectionTools.find(
          item =>
            Number(
              item.id
            ) ===
            Number(
              record.tool_id
            )
        );


      if (!tool) {
        return;
      }


      if (
        !ignoreExportStatus
      ) {

        const isExported =
          record.csv_exported ===
          true;


        if (
          exportStatus ===
            "unexported" &&
          isExported
        ) {

          return;
        }


        if (
          exportStatus ===
            "exported" &&
          !isExported
        ) {

          return;
        }
      }


      if (
        ownership &&
        tool.ownership_type !==
        ownership
      ) {

        return;
      }


      if (
        siteId &&
        String(
          tool.current_site_id ||
          ""
        ) !==
        String(
          siteId
        )
      ) {

        return;
      }


      if (
        employeeId &&
        String(
          tool.assigned_employee_id ||
          ""
        ) !==
        String(
          employeeId
        )
      ) {

        return;
      }


      if (
        contractor &&
        String(
          tool.owner_company_name ||
          ""
        ) !==
        contractor
      ) {

        return;
      }


      if (
        group &&
        getToolGroup(
          tool
        ) !==
        group
      ) {

        return;
      }


      if (
        toolName &&
        tool.tool_name !==
        toolName
      ) {

        return;
      }


      items.push({
        tool,
        record
      });
    }
  );


  return items;
}


/* =========================================
   CSV対象件数
========================================= */

function updateCsvTargetCount() {

  const items =
    getCsvTargetItems();


  inspectionCsvTargetCount.textContent =
    `出力対象：${items.length}件`;


  inspectionCsvExportButton.disabled =
    items.length ===
    0;
}


/* =========================================
   CSV設定を開く
========================================= */

function openCsvSettings() {

  inspectionCsvMessage.textContent =
    "";


  inspectionCsvSettingsPanel.style.display =
    "block";


  updateCsvTargetCount();


  inspectionCsvSettingsPanel
    .scrollIntoView({
      behavior:
        "smooth",

      block:
        "start"
    });
}


/* =========================================
   CSV設定を閉じる
========================================= */

function closeCsvSettings() {

  inspectionCsvSettingsPanel.style.display =
    "none";


  inspectionCsvMessage.textContent =
    "";
}


/* =========================================
   CSV本体作成
========================================= */

function createCsvText(
  items
) {

  const header = [
    "工具名",
    "型式",
    "メーカー",
    "製造番号",
    "性能",
    "①",
    "②",
    "③",
    "④",
    "⑤",
    "⑥",
    "⑦",
    "⑧",
    "⑨",
    "⑩",
    "⑪",
    "⑫",
    "備考",
    "点検済みシール",
    "点検日",
    "点検者",
    "シール番号"
  ];


  const rows = [
    header
  ];


  items.forEach(
    item => {

      const tool =
        item.tool;


      const record =
        item.record;


      const inspectorName =
        employeeNameMap.get(
          Number(
            record.inspector_employee_id
          )
        ) || "";


      rows.push([
        tool.tool_name || "",
        tool.model_number || "",
        tool.manufacturer || "",
        tool.serial_number || "",
        tool.performance || "",

        getChecklistCsvValue(
          record,
          1
        ),

        getChecklistCsvValue(
          record,
          2
        ),

        getChecklistCsvValue(
          record,
          3
        ),

        getChecklistCsvValue(
          record,
          4
        ),

        getChecklistCsvValue(
          record,
          5
        ),

        getChecklistCsvValue(
          record,
          6
        ),

        getChecklistCsvValue(
          record,
          7
        ),

        getChecklistCsvValue(
          record,
          8
        ),

        getChecklistCsvValue(
          record,
          9
        ),

        getChecklistCsvValue(
          record,
          10
        ),

        getChecklistCsvValue(
          record,
          11
        ),

        getChecklistCsvValue(
          record,
          12
        ),

        buildInspectionNote(
          tool,
          record
        ),

        record.sticker_confirmed
          ? "○"
          : "",

        record.inspection_date ||
        "",

        inspectorName,

        record.sticker_number ??
        ""
      ]);
    }
  );


  return rows
    .map(
      row =>
        row
          .map(
            csvEscape
          )
          .join(",")
    )
    .join(
      "\r\n"
    );
}


/* =========================================
   出力済みに更新
========================================= */

async function markCsvExported(
  items
) {

  /*
    まだ未出力のものだけ更新
  */

  const ids =
    items
      .filter(
        item =>
          item.record.csv_exported !==
          true
      )
      .map(
        item =>
          item.record.id
      )
      .filter(
        Boolean
      );


  if (
    ids.length ===
    0
  ) {

    return;
  }


  const idList =
    ids.join(
      ","
    );


  const url =
    `${SUPABASE_URL}/rest/v1/tool_inspections` +
    `?id=in.(${idList})`;


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
            "return=minimal"
        },

        body:
          JSON.stringify({

            csv_exported:
              true,

            csv_exported_at:
              new Date()
                .toISOString()
          })
      }
    );


  if (!response.ok) {

    console.error(
      await response.text()
    );


    throw new Error(
      "CSV出力済み状態を保存できませんでした"
    );
  }
}


/* =========================================
   CSVダウンロード
========================================= */

function downloadCsv(
  csvText,
  itemCount
) {

  const blob =
    new Blob(
      [
        "\uFEFF",
        csvText
      ],
      {
        type:
          "text/csv;charset=utf-8;"
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


  const safeCycleName =
    String(
      currentCycle.cycle_name ||
      "半年点検"
    )
      .replace(
        /[\\/:*?"<>|]/g,
        "_"
      );


  const today =
    new Date();


  const dateText =
    `${today.getFullYear()}` +
    `${String(
      today.getMonth() + 1
    ).padStart(
      2,
      "0"
    )}` +
    `${String(
      today.getDate()
    ).padStart(
      2,
      "0"
    )}`;


  link.href =
    url;


  link.download =
    `${safeCycleName}_点検結果_${dateText}_${itemCount}件.csv`;


  document.body
    .appendChild(
      link
    );


  link.click();


  link.remove();


  URL.revokeObjectURL(
    url
  );
}


/* =========================================
   CSV出力
========================================= */

async function exportInspectionCsv() {

  inspectionCsvMessage.textContent =
    "";


  const items =
    getCsvTargetItems();


  if (
    items.length ===
    0
  ) {

    alert(
      "出力対象がありません"
    );

    return;
  }


  const confirmed =
    window.confirm(
      `${items.length}件をCSV出力しますか？`
  );


  if (!confirmed) {
    return;
  }


  inspectionCsvExportButton.disabled =
    true;


  inspectionCsvExportButton.textContent =
    "出力中...";


  try {

    const csvText =
      createCsvText(
        items
      );


    /*
      出力済み状態を保存してから
      CSVをダウンロード
    */

    await markCsvExported(
      items
    );


    downloadCsv(
      csvText,
      items.length
    );


    await loadInspectionRecords();


    updateCsvTargetCount();


    inspectionCsvMessage.textContent =
      `${items.length}件を出力済みにしました`;


  } catch (error) {

    console.error(
      error
    );


    inspectionCsvMessage.textContent =
      error.message;


  } finally {

    inspectionCsvExportButton.disabled =
      false;


    inspectionCsvExportButton.textContent =
      "CSVを出力する";


    updateCsvTargetCount();
  }
}


/* =========================================
   出力済みを未出力へ戻す
========================================= */

async function resetCsvExported() {

  inspectionCsvMessage.textContent =
    "";


  /*
    出力状態の選択には関係なく
    現在のその他の絞り込み条件で
    出力済みだけを対象にする
  */

  const items =
    getCsvTargetItems({
      ignoreExportStatus:
        true
    })
      .filter(
        item =>
          item.record.csv_exported ===
          true
      );


  if (
    items.length ===
    0
  ) {

    alert(
      "未出力に戻せるデータがありません"
    );

    return;
  }


  const confirmed =
    window.confirm(
      `${items.length}件を未出力に戻しますか？`
  );


  if (!confirmed) {
    return;
  }


  const ids =
    items
      .map(
        item =>
          item.record.id
      )
      .filter(
        Boolean
      );


  const idList =
    ids.join(
      ","
    );


  try {

    inspectionCsvResetExportedButton.disabled =
      true;


    const url =
      `${SUPABASE_URL}/rest/v1/tool_inspections` +
      `?id=in.(${idList})`;


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
              "return=minimal"
          },

          body:
            JSON.stringify({

              csv_exported:
                false,

              csv_exported_at:
                null
            })
        }
      );


    if (!response.ok) {

      console.error(
        await response.text()
      );


      throw new Error(
        "未出力に戻せませんでした"
      );
    }


    await loadInspectionRecords();


    updateCsvTargetCount();


    inspectionCsvMessage.textContent =
      `${items.length}件を未出力に戻しました`;


  } catch (error) {

    console.error(
      error
    );


    inspectionCsvMessage.textContent =
      error.message;


  } finally {

    inspectionCsvResetExportedButton.disabled =
      false;
  }
}


/* =========================================
   CSV条件変更
========================================= */

function handleCsvFilterChange() {

  updateCsvTargetCount();
}


/* =========================================
   イベント
========================================= */

inspectionGroupFilter
  .addEventListener(
    "change",
    () => {

      updateToolNameFilter();


      inspectionToolResultSection
        .classList
        .add(
          "hidden"
        );
    }
  );


inspectionToolNameFilter
  .addEventListener(
    "change",
    () => {

      inspectionToolResultSection
        .classList
        .add(
          "hidden"
        );
    }
  );


inspectionStatusFilter
  .addEventListener(
    "change",
    () => {

      inspectionToolResultSection
        .classList
        .add(
          "hidden"
        );
    }
  );


inspectionSearchButton
  .addEventListener(
    "click",
    searchInspectionTools
  );


inspectionQrStartButton
  .addEventListener(
    "click",
    startInspectionQrReader
  );


inspectionQrCancelButton
  .addEventListener(
    "click",
    cancelInspectionQrReader
  );


inspectionToolResultClose
  .addEventListener(
    "click",
    () => {

      inspectionToolResultSection
        .classList
        .add(
          "hidden"
        );
    }
  );


/* =========================================
   CSVイベント
========================================= */

openInspectionCsvSettingsButton
  .addEventListener(
    "click",
    openCsvSettings
  );


closeInspectionCsvSettingsButton
  .addEventListener(
    "click",
    closeCsvSettings
  );


inspectionCsvExportStatus
  .addEventListener(
    "change",
    handleCsvFilterChange
  );


inspectionCsvOwnershipFilter
  .addEventListener(
    "change",
    handleCsvFilterChange
  );


inspectionCsvSiteFilter
  .addEventListener(
    "change",
    handleCsvFilterChange
  );


inspectionCsvEmployeeFilter
  .addEventListener(
    "change",
    handleCsvFilterChange
  );


inspectionCsvContractorFilter
  .addEventListener(
    "change",
    handleCsvFilterChange
  );


inspectionCsvGroupFilter
  .addEventListener(
    "change",
    updateCsvToolNameFilter
  );


inspectionCsvToolNameFilter
  .addEventListener(
    "change",
    handleCsvFilterChange
  );


inspectionCsvExportButton
  .addEventListener(
    "click",
    exportInspectionCsv
  );


inspectionCsvResetExportedButton
  .addEventListener(
    "click",
    resetCsvExported
  );


/* =========================================
   初期化
========================================= */

async function initialize() {

  inspectionListMessage.textContent =
    "";


  inspectionToolResultSection
    .classList
    .add(
      "hidden"
    );


  try {

    await loadCycle();


    await Promise.all([
      loadInspectionTools(),
      loadInspectionRecords(),
      loadEmployees(),
      loadSites()
    ]);


    inspectionQrStartButton.disabled =
      false;


    updateProgress();


    buildGroupFilter();


    updateToolNameFilter();


    buildCsvFilters();


    updateCsvTargetCount();


  } catch (error) {

    console.error(
      error
    );


    inspectionListMessage.textContent =
      error.message;
  }
}


initialize();
