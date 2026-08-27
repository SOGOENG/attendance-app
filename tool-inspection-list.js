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

const inspectionCsvExportButton =
  document.getElementById(
    "inspectionCsvExportButton"
  );


/* =========================================
   データ
========================================= */

let currentCycle = null;

let inspectionTools = [];

let inspectionRecords = [];

let employees = [];

const inspectedToolIdSet =
  new Set();

const employeeNameMap =
  new Map();


/* =========================================
   大分類表示順
========================================= */

const TOOL_GROUP_ORDER = [
  "配管加工機",
  "切断工具",
  "研磨・仕上げ工具",
  "穴あけ・斫り工具",
  "電動・汎用工具",
  "集塵・吸引",
  "測定・探査",
  "その他"
];


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


function getCycleIdFromUrl() {
  const params =
    new URLSearchParams(
      window.location.search
    );

  return params.get("cycle");
}


function formatCycleStatus(status) {
  switch (status) {

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


function getToolGroup(tool) {
  return (
    tool.tool_group?.trim() ||
    "その他"
  );
}


function sortToolGroups(groups) {
  return groups.sort(
    (a, b) => {

      const aIndex =
        TOOL_GROUP_ORDER.indexOf(a);

      const bIndex =
        TOOL_GROUP_ORDER.indexOf(b);

      if (
        aIndex !== -1 &&
        bIndex !== -1
      ) {
        return aIndex - bIndex;
      }

      if (aIndex !== -1) {
        return -1;
      }

      if (bIndex !== -1) {
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

function splitEmployeeName(name) {
  const normalized =
    String(name || "")
      .replace(/\u3000/g, " ")
      .trim();

  const parts =
    normalized
      .split(/\s+/)
      .filter(Boolean);

  if (parts.length >= 2) {
    return {
      family: parts[0],
      given: parts.slice(1).join("")
    };
  }

  return {
    family: normalized,
    given: ""
  };
}


function getShortEmployeeName(
  employeeId
) {
  const employee =
    employees.find(
      item =>
        Number(item.id) ===
        Number(employeeId)
    );

  if (!employee) {
    return "";
  }


  const current =
    splitEmployeeName(
      employee.name
    );


  if (!current.family) {
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
      current.given.charAt(0)
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
    await portalFetch(url);


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


  if (records.length === 0) {
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
    await portalFetch(url);


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
    await portalFetch(url);


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
        Number(record.tool_id)
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
    await portalFetch(url);


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
        Number(employee.id),
        employee.name || ""
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
          Number(tool.id)
        )
    ).length;


  const pending =
    total - completed;


  inspectionTargetCount.textContent =
    total;


  inspectionCompletedCount.textContent =
    completed;


  inspectionPendingCount.textContent =
    pending;
}


/* =========================================
   大分類
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
          inspectionTools.map(
            tool =>
              getToolGroup(tool)
          )
        )
      ]
    );


  groups.forEach(group => {

    const option =
      document.createElement(
        "option"
      );


    option.value =
      group;


    option.textContent =
      group;


    inspectionGroupFilter.appendChild(
      option
    );
  });
}


/* =========================================
   工具名
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
              getToolGroup(tool) ===
              selectedGroup
          )
          .map(
            tool =>
              tool.tool_name
          )
          .filter(Boolean)
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


      inspectionToolNameFilter.appendChild(
        option
      );
    }
  );


  inspectionToolNameFilter.disabled =
    false;
}


/* =========================================
   絞り込み
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
            Number(tool.id)
          );


        if (
          getToolGroup(tool) !==
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


  inspectionToolResultSection.classList.remove(
    "hidden"
  );


  displayInspectionTools(
    filtered
  );


  inspectionToolResultSection.scrollIntoView({
    behavior: "smooth",
    block: "start"
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


  if (tools.length === 0) {

    inspectionToolList.innerHTML =
      `
        <p class="schedule-empty-message">
          該当する工具はありません
        </p>
      `;

    return;
  }


  tools.forEach(tool => {

    const isCompleted =
      inspectedToolIdSet.has(
        Number(tool.id)
      );


    const inspectionRecord =
      inspectionRecords.find(
        record =>
          Number(record.tool_id) ===
          Number(tool.id)
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


    inspectionToolList.appendChild(
      card
    );
  });
}


/* =========================================
   CSV共通
========================================= */

function csvEscape(value) {
  const text =
    String(value ?? "");


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
    results[String(number)];


  if (!item) {
    return "";
  }


  if (!item.checked) {
    return "";
  }


  return item.mark || "○";
}


/* =========================================
   CSV備考
========================================= */

function buildInspectionNote(
  tool,
  record
) {
  const parts = [];


  if (
    record.sticker_number !== null &&
    record.sticker_number !== undefined &&
    record.sticker_number !== ""
  ) {
    parts.push(
      `シールNo.${record.sticker_number}`
    );
  }


  if (
    tool.ownership_type === "personal" &&
    tool.assigned_employee_id
  ) {
    const employeeName =
      getShortEmployeeName(
        tool.assigned_employee_id
      );


    if (employeeName) {
      parts.push(
        employeeName
      );
    }
  }


  if (record.note) {
    parts.push(
      record.note
    );
  }


  return parts.join("　");
}


/* =========================================
   CSV出力
========================================= */

function exportInspectionCsv() {
  const completedTools =
    inspectionTools.filter(
      tool =>
        inspectedToolIdSet.has(
          Number(tool.id)
        )
    );


  const pendingCount =
    inspectionTools.length -
    completedTools.length;


  if (
    completedTools.length === 0
  ) {
    alert(
      "点検済み工具がありません"
    );

    return;
  }


  if (
    pendingCount > 0
  ) {

    const confirmed =
      window.confirm(
        `未点検工具が${pendingCount}件あります。\n\n` +
        `点検済み${completedTools.length}件のみCSV出力しますか？`
      );


    if (
      confirmed !== true
    ) {
      return;
    }
  }


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


  completedTools.forEach(
    tool => {

      const record =
        inspectionRecords.find(
          item =>
            Number(item.tool_id) ===
            Number(tool.id)
        );


      if (!record) {
        return;
      }


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


  const csvText =
    rows
      .map(
        row =>
          row
            .map(csvEscape)
            .join(",")
      )
      .join("\r\n");


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


  link.href =
    url;


  link.download =
    `${safeCycleName}_点検結果.csv`;


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
   イベント
========================================= */

inspectionGroupFilter.addEventListener(
  "change",
  () => {

    updateToolNameFilter();


    inspectionToolResultSection.classList.add(
      "hidden"
    );
  }
);


inspectionToolNameFilter.addEventListener(
  "change",
  () => {

    inspectionToolResultSection.classList.add(
      "hidden"
    );
  }
);


inspectionStatusFilter.addEventListener(
  "change",
  () => {

    inspectionToolResultSection.classList.add(
      "hidden"
    );
  }
);


inspectionSearchButton.addEventListener(
  "click",
  searchInspectionTools
);


inspectionToolResultClose.addEventListener(
  "click",
  () => {

    inspectionToolResultSection.classList.add(
      "hidden"
    );
  }
);


if (
  inspectionCsvExportButton
) {

  inspectionCsvExportButton.addEventListener(
    "click",
    exportInspectionCsv
  );
}


/* =========================================
   初期化
========================================= */

async function initialize() {
  inspectionListMessage.textContent =
    "";


  inspectionToolResultSection.classList.add(
    "hidden"
  );


  try {

    await loadCycle();


    await Promise.all([
      loadInspectionTools(),
      loadInspectionRecords(),
      loadEmployees()
    ]);


    updateProgress();


    buildGroupFilter();


    updateToolNameFilter();

  } catch (error) {

    console.error(
      error
    );


    inspectionListMessage.textContent =
      error.message;
  }
}


initialize();