/* =========================================
   Supabase
========================================= */

const SUPABASE_URL =
  "https://fgmvmbjnoyagnpygcbky.supabase.co";


/* =========================================
   HTML要素
========================================= */

const sharedToolSearch =
  document.getElementById("sharedToolSearch");

const sharedToolSearchButton =
  document.getElementById("sharedToolSearchButton");

const toolGroupSelect =
  document.getElementById("toolGroupSelect");

const toolNameSelect =
  document.getElementById("toolNameSelect");

const toolSearchByCategoryButton =
  document.getElementById("toolSearchByCategoryButton");

const toolSiteSelect =
  document.getElementById("toolSiteSelect");

const toolSearchBySiteButton =
  document.getElementById("toolSearchBySiteButton");

const stockGroupSelect =
  document.getElementById("stockGroupSelect");

const stockToolNameSelect =
  document.getElementById("stockToolNameSelect");

const toolSearchStockButton =
  document.getElementById("toolSearchStockButton");

const sharedToolResultSection =
  document.getElementById("sharedToolResultSection");

const sharedToolResultTitle =
  document.getElementById("sharedToolResultTitle");

const sharedToolResultClose =
  document.getElementById("sharedToolResultClose");

const sharedToolMessage =
  document.getElementById("sharedToolMessage");

const sharedToolList =
  document.getElementById("sharedToolList");


/* =========================================
   データ
========================================= */

let sharedToolRecords = [];
let siteRecords = [];
let employeeRecords = [];

const siteNameMap = new Map();
const employeeNameMap = new Map();


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


function getToolGroup(tool) {
  return tool.tool_group?.trim() || "その他";
}


function getSiteName(tool) {
  if (!tool.current_site_id) {
    return "倉庫";
  }

  return (
    siteNameMap.get(
      String(tool.current_site_id)
    ) || "-"
  );
}


function getEmployeeName(tool) {
  if (!tool.assigned_employee_id) {
    return "-";
  }

  return (
    employeeNameMap.get(
      String(tool.assigned_employee_id)
    ) || "-"
  );
}


function sortToolGroups(groups) {
  return groups.sort((a, b) => {
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
  });
}


/* =========================================
   現場読込
========================================= */

async function loadSites() {
  const url =
    `${SUPABASE_URL}/rest/v1/sites` +
    `?select=id,display_name,visible,display_order` +
    `&visible=eq.true` +
    `&order=display_order.asc`;

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

  siteNameMap.clear();

  siteRecords.forEach(site => {
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
    `?select=id,name,active` +
    `&active=eq.true`;

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
}


/* =========================================
   工具読込
========================================= */

async function loadTools() {
  const url =
    `${SUPABASE_URL}/rest/v1/tools` +
    `?select=*` +
    `&ownership_type=eq.shared` +
    `&status=neq.disposed` +
    `&order=tool_name.asc,management_code.asc`;

  const response =
    await portalFetch(url);

  if (!response.ok) {
    const errorText =
      await response.text();

    console.error(errorText);

    throw new Error(
      "共有工具を読み込めませんでした"
    );
  }

  sharedToolRecords =
    await response.json();
}


/* =========================================
   大分類プルダウン作成
========================================= */

function buildGroupSelects() {
  const groups =
    sortToolGroups(
      [
        ...new Set(
          sharedToolRecords.map(
            tool =>
              getToolGroup(tool)
          )
        )
      ]
    );

  toolGroupSelect.innerHTML =
    `
      <option value="">
        ---- 大分類を選択 ----
      </option>
    `;

  stockGroupSelect.innerHTML =
    `
      <option value="">
        ---- 大分類を選択 ----
      </option>
    `;

  groups.forEach(group => {
    const option1 =
      document.createElement("option");

    option1.value = group;
    option1.textContent = group;

    toolGroupSelect.appendChild(
      option1
    );


    const option2 =
      document.createElement("option");

    option2.value = group;
    option2.textContent = group;

    stockGroupSelect.appendChild(
      option2
    );
  });
}


/* =========================================
   工具名プルダウン
========================================= */

function updateToolNameSelect() {
  const selectedGroup =
    toolGroupSelect.value;

  toolNameSelect.innerHTML =
    `
      <option value="">
        ---- 工具名を選択 ----
      </option>
    `;

  if (!selectedGroup) {
    toolNameSelect.disabled =
      true;

    return;
  }

  const toolNames =
    [
      ...new Set(
        sharedToolRecords
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

  toolNames.forEach(toolName => {
    const option =
      document.createElement("option");

    option.value = toolName;
    option.textContent = toolName;

    toolNameSelect.appendChild(
      option
    );
  });

  toolNameSelect.disabled =
    false;
}


/* =========================================
   在庫工具名プルダウン
========================================= */

function updateStockToolNameSelect() {
  const selectedGroup =
    stockGroupSelect.value;

  stockToolNameSelect.innerHTML =
    `
      <option value="">
        ---- 工具名を選択 ----
      </option>
    `;

  if (!selectedGroup) {
    stockToolNameSelect.disabled =
      true;

    return;
  }

  const toolNames =
    [
      ...new Set(
        sharedToolRecords
          .filter(
            tool =>
              tool.status ===
                "available" &&
              !tool.current_site_id &&
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

  toolNames.forEach(toolName => {
    const option =
      document.createElement("option");

    option.value = toolName;
    option.textContent = toolName;

    stockToolNameSelect.appendChild(
      option
    );
  });

  stockToolNameSelect.disabled =
    false;
}


/* =========================================
   現場プルダウン
========================================= */

function buildSiteSelect() {
  toolSiteSelect.innerHTML =
    `
      <option value="">
        ---- 現場を選択 ----
      </option>
    `;

  siteRecords.forEach(site => {
    const count =
      sharedToolRecords.filter(
        tool =>
          String(
            tool.current_site_id
          ) ===
          String(site.id)
      ).length;

    if (count === 0) {
      return;
    }

    const option =
      document.createElement("option");

    option.value =
      site.id;

    option.textContent =
      `${site.display_name}（${count}）`;

    toolSiteSelect.appendChild(
      option
    );
  });
}


/* =========================================
   工具から探す
========================================= */

function searchByCategory() {
  const group =
    toolGroupSelect.value;

  const toolName =
    toolNameSelect.value;

  if (!group) {
    alert(
      "大分類を選択してください"
    );

    return;
  }

  if (!toolName) {
    alert(
      "工具名を選択してください"
    );

    return;
  }

  const filtered =
    sharedToolRecords.filter(
      tool =>
        getToolGroup(tool) ===
          group &&
        tool.tool_name ===
          toolName
    );

  showResult(
    `${group} ＞ ${toolName}`,
    filtered
  );
}


/* =========================================
   現場から探す
========================================= */

function searchBySite() {
  const siteId =
    toolSiteSelect.value;

  if (!siteId) {
    alert(
      "現場を選択してください"
    );

    return;
  }

  const siteName =
    siteNameMap.get(
      String(siteId)
    ) || "";

  const filtered =
    sharedToolRecords.filter(
      tool =>
        String(
          tool.current_site_id
        ) ===
        String(siteId)
    );

  showResult(
    `現場：${siteName}`,
    filtered
  );
}


/* =========================================
   在庫を見る
========================================= */

function searchStock() {
  const group =
    stockGroupSelect.value;

  const toolName =
    stockToolNameSelect.value;

  if (!group) {
    alert(
      "大分類を選択してください"
    );

    return;
  }

  if (!toolName) {
    alert(
      "工具名を選択してください"
    );

    return;
  }

  const filtered =
    sharedToolRecords.filter(
      tool =>
        tool.status ===
          "available" &&
        !tool.current_site_id &&
        getToolGroup(tool) ===
          group &&
        tool.tool_name ===
          toolName
    );

  showResult(
    `在庫：${group} ＞ ${toolName}`,
    filtered
  );
}


/* =========================================
   任意検索
========================================= */

function searchTools() {
  const rawKeyword =
    sharedToolSearch.value
      .trim();

  const keyword =
    rawKeyword.toLowerCase();

  if (!keyword) {
    alert(
      "検索文字を入力してください"
    );

    return;
  }

  const filtered =
    sharedToolRecords.filter(
      tool => {

        const target =
          [
            getToolGroup(tool),
            tool.tool_name,
            tool.specification,
            tool.management_code,
            tool.manufacturer,
            tool.model_number,
            tool.serial_number,
            tool.performance,
            getSiteName(tool),
            getEmployeeName(tool)
          ]
            .filter(Boolean)
            .join(" ")
            .toLowerCase();

        return target.includes(
          keyword
        );
      }
    );

  showResult(
    `検索結果：「${rawKeyword}」`,
    filtered
  );
}


/* =========================================
   結果表示
========================================= */

function showResult(
  title,
  tools
) {
  sharedToolResultTitle.textContent =
    title;

  sharedToolMessage.textContent =
    `${tools.length}件`;

  sharedToolResultSection.classList.remove(
    "hidden"
  );

  renderToolCards(
    tools
  );

  sharedToolResultSection.scrollIntoView({
    behavior: "smooth",
    block: "start"
  });
}


/* =========================================
   工具カード
========================================= */

function renderToolCards(tools) {
  sharedToolList.innerHTML =
    "";

  if (tools.length === 0) {
    sharedToolList.innerHTML =
      `
        <p class="schedule-empty-message">
          該当する工具はありません
        </p>
      `;

    return;
  }

  tools.forEach(tool => {
    const card =
      document.createElement(
        "article"
      );

    card.className =
      "tool-item-card";

    let actionButtons =
      "";

    if (
      tool.status ===
      "available"
    ) {
      actionButtons =
        `
          <a
            href="tool-detail.html?id=${tool.id}"
            class="admin-secondary-button"
          >
            詳細
          </a>

          <a
            href="tool-checkout.html?id=${tool.id}"
            class="admin-primary-button"
          >
            持出
          </a>
        `;
    }


    if (
      tool.status ===
      "in_use"
    ) {
      actionButtons =
        `
          <a
            href="tool-detail.html?id=${tool.id}"
            class="admin-secondary-button"
          >
            詳細
          </a>

          <a
            href="tool-move.html?id=${tool.id}"
            class="admin-secondary-button"
          >
            移動
          </a>

          <button
            type="button"
            class="admin-primary-button"
            onclick="returnTool(${tool.id})"
          >
            返却
          </button>
        `;
    }


    if (
      tool.status ===
        "repair" ||
      tool.status ===
        "stopped"
    ) {
      actionButtons =
        `
          <a
            href="tool-detail.html?id=${tool.id}"
            class="admin-secondary-button"
          >
            詳細
          </a>
        `;
    }


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
            現在地：
            ${escapeHtml(
              getSiteName(tool)
            )}
          </p>

          <p>
            担当者：
            ${escapeHtml(
              getEmployeeName(tool)
            )}
          </p>

          <p>
            状態：
            ${escapeHtml(
              formatToolStatus(
                tool.status
              )
            )}
          </p>

        </div>

        <div class="tool-item-actions">
          ${actionButtons}
        </div>
      `;

    sharedToolList.appendChild(
      card
    );
  });
}


/* =========================================
   返却
========================================= */

async function returnTool(toolId) {
  const tool =
    sharedToolRecords.find(
      item =>
        Number(item.id) ===
        Number(toolId)
    );

  if (!tool) {
    alert(
      "工具情報が見つかりません"
    );

    return;
  }

  const confirmed =
    window.confirm(
      `${tool.tool_name}` +
      `${
        tool.specification
          ? ` ${tool.specification}`
          : ""
      }\n\n` +
      "この工具を返却しますか？"
    );

  if (!confirmed) {
    return;
  }

  try {
    const loginUser =
      JSON.parse(
        localStorage.getItem(
          "portalLoginUser"
        ) || "null"
      );


    const toolUrl =
      `${SUPABASE_URL}/rest/v1/tools` +
      `?id=eq.${tool.id}`;

    const toolResponse =
      await portalFetch(
        toolUrl,
        {
          method: "PATCH",

          headers: {
            "Content-Type":
              "application/json",

            Prefer:
              "return=minimal"
          },

          body:
            JSON.stringify({
              current_site_id:
                null,

              assigned_employee_id:
                null,

              status:
                "available",

              updated_at:
                new Date()
                  .toISOString()
            })
        }
      );

    if (!toolResponse.ok) {
      throw new Error(
        "工具の返却に失敗しました"
      );
    }


    const historyUrl =
      `${SUPABASE_URL}/rest/v1/tool_history`;

    const historyResponse =
      await portalFetch(
        historyUrl,
        {
          method: "POST",

          headers: {
            "Content-Type":
              "application/json",

            Prefer:
              "return=minimal"
          },

          body:
            JSON.stringify({
              tool_id:
                tool.id,

              action_type:
                "return",

              from_site_id:
                tool.current_site_id ||
                null,

              to_site_id:
                null,

              from_employee_id:
                tool.assigned_employee_id ||
                null,

              to_employee_id:
                null,

              operated_by_employee_id:
                loginUser
                  ? loginUser.id
                  : null,

              note:
                null
            })
        }
      );

    if (!historyResponse.ok) {
      throw new Error(
        "返却履歴の保存に失敗しました"
      );
    }


    alert(
      "工具を返却しました"
    );

    await initialize();

    sharedToolResultSection.classList.add(
      "hidden"
    );

  } catch (error) {
    console.error(error);

    alert(
      error.message
    );
  }
}


/* =========================================
   イベント
========================================= */

toolGroupSelect.addEventListener(
  "change",
  updateToolNameSelect
);

stockGroupSelect.addEventListener(
  "change",
  updateStockToolNameSelect
);

toolSearchByCategoryButton.addEventListener(
  "click",
  searchByCategory
);

toolSearchBySiteButton.addEventListener(
  "click",
  searchBySite
);

toolSearchStockButton.addEventListener(
  "click",
  searchStock
);

sharedToolSearchButton.addEventListener(
  "click",
  searchTools
);

sharedToolSearch.addEventListener(
  "keydown",
  event => {
    if (
      event.key ===
      "Enter"
    ) {
      searchTools();
    }
  }
);

sharedToolResultClose.addEventListener(
  "click",
  () => {
    sharedToolResultSection.classList.add(
      "hidden"
    );
  }
);


/* =========================================
   初期化
========================================= */

async function initialize() {
  try {
    await Promise.all([
      loadSites(),
      loadEmployees(),
      loadTools()
    ]);

    buildGroupSelects();

    buildSiteSelect();

    updateToolNameSelect();

    updateStockToolNameSelect();

  } catch (error) {
    console.error(error);

    alert(
      error.message
    );
  }
}


initialize();