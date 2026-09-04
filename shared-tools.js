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

const sharedToolSummary =
  document.getElementById("sharedToolSummary");

const sharedToolList =
  document.getElementById("sharedToolList");

const sharedToolQrStartButton =
  document.getElementById(
    "sharedToolQrStartButton"
  );

const sharedToolQrPanel =
  document.getElementById(
    "sharedToolQrPanel"
  );

const sharedToolQrCancelButton =
  document.getElementById(
    "sharedToolQrCancelButton"
  );

const sharedToolQrMessage =
  document.getElementById(
    "sharedToolQrMessage"
  );


/* =========================================
   データ
========================================= */

let sharedToolRecords = [];
let siteRecords = [];
let employeeRecords = [];

const siteNameMap =
  new Map();

const employeeNameMap =
  new Map();

let sharedToolQrScanner =
  null;

let sharedToolQrScanning =
  false;

let sharedToolQrProcessing =
  false;

let sharedToolQrSessionId =
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


async function stopSharedToolQrReader() {

  if (
    !sharedToolQrScanner ||
    !sharedToolQrScanning
  ) {

    return;
  }


  try {

    await sharedToolQrScanner.stop();

  } catch (error) {

    console.warn(
      error
    );
  }


  sharedToolQrScanning =
    false;


  try {

    sharedToolQrScanner.clear();

  } catch (error) {

    console.warn(
      error
    );
  }


  sharedToolQrScanner =
    null;
}


async function cancelSharedToolQrReader() {

  sharedToolQrSessionId +=
    1;


  await stopSharedToolQrReader();


  sharedToolQrProcessing =
    false;


  sharedToolQrPanel.classList.add(
    "hidden"
  );


  sharedToolQrStartButton.disabled =
    false;


  sharedToolQrMessage.textContent =
    "QRコードの読み取りをキャンセルしました";
}


async function loadQrTool(
  toolId
) {

  const url =
    `${SUPABASE_URL}/rest/v1/tools` +
    `?id=eq.${encodeURIComponent(
      toolId
    )}` +
    `&select=id,ownership_type`;


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


async function handleSharedToolQrResult(
  decodedText
) {

  if (sharedToolQrProcessing) {
    return;
  }


  const toolId =
    getToolIdFromQrText(
      decodedText
    );


  if (!toolId) {

    sharedToolQrMessage.textContent =
      "工具用QRコードではありません";

    return;
  }


  sharedToolQrProcessing =
    true;


  await stopSharedToolQrReader();


  sharedToolQrPanel.classList.add(
    "hidden"
  );


  sharedToolQrMessage.textContent =
    "工具情報を確認しています…";


  try {

    const tool =
      await loadQrTool(
        toolId
      );


    if (!tool) {

      sharedToolQrMessage.textContent =
        "工具が見つかりません";

      return;
    }


    if (
      tool.ownership_type !==
      "shared"
    ) {

      sharedToolQrMessage.textContent =
        "この工具は共有工具ではありません";

      return;
    }


    window.location.href =
      `tool-detail.html?id=${encodeURIComponent(
        tool.id
      )}`;

  } catch (error) {

    console.error(
      error
    );


    sharedToolQrMessage.textContent =
      error.message;


  } finally {

    sharedToolQrProcessing =
      false;


    sharedToolQrStartButton.disabled =
      false;
  }
}


function getCameraErrorMessage(
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


async function startSharedToolQrReader() {

  if (
    sharedToolQrScanning ||
    sharedToolQrProcessing
  ) {

    return;
  }


  if (
    typeof Html5Qrcode ===
    "undefined"
  ) {

    sharedToolQrMessage.textContent =
      "QR読取機能を読み込めませんでした";

    return;
  }


  sharedToolQrPanel.classList.remove(
    "hidden"
  );


  sharedToolQrStartButton.disabled =
    true;


  sharedToolQrMessage.textContent =
    "カメラを起動しています…";


  const sessionId =
    sharedToolQrSessionId +
    1;


  sharedToolQrSessionId =
    sessionId;


  let scanner =
    null;


  try {

    scanner =
      new Html5Qrcode(
        "sharedToolQrReader"
      );


    sharedToolQrScanner =
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

        handleSharedToolQrResult(
          decodedText
        );
      },
      () => {}
    );


    if (
      sessionId !==
      sharedToolQrSessionId
    ) {

      await scanner.stop();


      scanner.clear();


      if (
        sharedToolQrScanner ===
        scanner
      ) {

        sharedToolQrScanner =
          null;
      }


      return;
    }


    sharedToolQrScanning =
      true;


    sharedToolQrMessage.textContent =
      "QRコードを枠内に合わせてください";

  } catch (error) {

    if (
      sessionId !==
      sharedToolQrSessionId
    ) {

      return;
    }


    console.error(
      error
    );


    await stopSharedToolQrReader();


    if (scanner) {

      try {

        scanner.clear();

      } catch (clearError) {

        console.warn(
          clearError
        );
      }
    }


    if (
      sharedToolQrScanner ===
      scanner
    ) {

      sharedToolQrScanner =
        null;
    }


    sharedToolQrPanel.classList.add(
      "hidden"
    );


    sharedToolQrMessage.textContent =
      getCameraErrorMessage(
        error
      );


    sharedToolQrStartButton.disabled =
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

function escapeHtml(value) {

  return String(
    value ?? ""
  )
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

  return (
    tool.tool_group?.trim() ||
    "その他"
  );
}


function getSiteName(tool) {

  if (
    !tool.current_site_id
  ) {

    return "倉庫";
  }


  return (
    siteNameMap.get(
      String(
        tool.current_site_id
      )
    ) ||
    "-"
  );
}


function getEmployeeName(tool) {

  if (
    !tool.assigned_employee_id
  ) {

    return "-";
  }


  return (
    employeeNameMap.get(
      String(
        tool.assigned_employee_id
      )
    ) ||
    "-"
  );
}


function getCompactLocationText(
  tool
) {

  return tool.current_site_id
    ? "現場"
    : "倉庫";
}


function getDisplayStatus(
  tool
) {

  if (
    tool.status === "repair" ||
    tool.status === "stopped" ||
    tool.status === "disposed"
  ) {

    return tool.status;
  }


  return tool.current_site_id
    ? "in_use"
    : "available";
}


function isToolAvailableForCheckout(
  tool
) {

  return (
    tool.ownership_type === "shared" &&
    tool.active === true &&
    tool.checkout_managed !== false &&
    !tool.current_site_id &&
    tool.status === "available" &&
    getDisplayStatus(tool) === "available"
  );
}


function isToolInUse(
  tool
) {

  return (
    tool.ownership_type === "shared" &&
    tool.active === true &&
    Boolean(tool.current_site_id) &&
    getDisplayStatus(tool) === "in_use"
  );
}


function sortToolGroups(groups) {

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
   現場読込
========================================= */

async function loadSites() {

  const url =
    `${SUPABASE_URL}/rest/v1/sites` +
    `?select=id,display_name,visible,display_order` +
    `&visible=eq.true` +
    `&order=display_order.asc`;


  const response =
    await portalFetch(
      url
    );


  if (
    !response.ok
  ) {

    console.error(
      await response.text()
    );


    throw new Error(
      "現場一覧を読み込めませんでした"
    );
  }


  siteRecords =
    await response.json();


  siteNameMap.clear();


  siteRecords.forEach(
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
    `?select=id,name,active` +
    `&active=eq.true`;


  const response =
    await portalFetch(
      url
    );


  if (
    !response.ok
  ) {

    console.error(
      await response.text()
    );


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
        String(
          employee.id
        ),
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
    await portalFetch(
      url
    );


  if (
    !response.ok
  ) {

    console.error(
      await response.text()
    );


    throw new Error(
      "共有工具を読み込めませんでした"
    );
  }


  sharedToolRecords =
    await response.json();
}


/* =========================================
   大分類プルダウン
========================================= */

function buildGroupSelects() {

  const groups =
    sortToolGroups(
      [
        ...new Set(
          [
            ...TOOL_GROUP_ORDER,
            ...sharedToolRecords.map(
              tool =>
                getToolGroup(
                  tool
                )
            )
          ]
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


  groups.forEach(
    group => {

      const option1 =
        document.createElement(
          "option"
        );


      option1.value =
        group;


      option1.textContent =
        group;


      toolGroupSelect.appendChild(
        option1
      );


      const option2 =
        document.createElement(
          "option"
        );


      option2.value =
        group;


      option2.textContent =
        group;


      stockGroupSelect.appendChild(
        option2
      );
    }
  );
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


  if (
    !selectedGroup
  ) {

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


      toolNameSelect.appendChild(
        option
      );
    }
  );


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


  if (
    !selectedGroup
  ) {

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
              !tool.current_site_id &&
              getDisplayStatus(
                tool
              ) ===
                "available" &&
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


      stockToolNameSelect.appendChild(
        option
      );
    }
  );


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


  siteRecords.forEach(
    site => {

      const count =
        sharedToolRecords.filter(
          tool =>
            String(
              tool.current_site_id
            ) ===
            String(
              site.id
            )
        ).length;


      if (
        count ===
        0
      ) {

        return;
      }


      const option =
        document.createElement(
          "option"
        );


      option.value =
        site.id;


      option.textContent =
        `${site.display_name}（${count}）`;


      toolSiteSelect.appendChild(
        option
      );
    }
  );
}


/* =========================================
   工具から探す
========================================= */

function searchByCategory() {

  const group =
    toolGroupSelect.value;


  const toolName =
    toolNameSelect.value;


  if (
    !group
  ) {

    alert(
      "大分類を選択してください"
    );

    return;
  }


  if (
    !toolName
  ) {

    alert(
      "工具名を選択してください"
    );

    return;
  }


  const filtered =
    sharedToolRecords.filter(
      tool =>
        getToolGroup(
          tool
        ) ===
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


  if (
    !siteId
  ) {

    alert(
      "現場を選択してください"
    );

    return;
  }


  const siteName =
    siteNameMap.get(
      String(
        siteId
      )
    ) ||
    "";


  const filtered =
    sharedToolRecords.filter(
      tool =>
        String(
          tool.current_site_id
        ) ===
        String(
          siteId
        )
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


  if (
    !group
  ) {

    alert(
      "大分類を選択してください"
    );

    return;
  }


  if (
    !toolName
  ) {

    alert(
      "工具名を選択してください"
    );

    return;
  }


  const filtered =
    sharedToolRecords.filter(
      tool =>
        isToolAvailableForCheckout(tool) &&
        getToolGroup(
          tool
        ) ===
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
    rawKeyword
      .toLowerCase();


  if (
    !keyword
  ) {

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
            getToolGroup(
              tool
            ),
            tool.tool_name,
            tool.specification,
            tool.management_code,
            tool.manufacturer,
            tool.model_number,
            tool.serial_number,
            tool.performance,
            getSiteName(
              tool
            ),
            getEmployeeName(
              tool
            )
          ]
            .filter(
              Boolean
            )
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


  const availableCount =
    tools.filter(isToolAvailableForCheckout).length;


  const inUseCount =
    tools.filter(isToolInUse).length;


  sharedToolSummary.innerHTML =
    `
      <div class="shared-tool-summary-item is-available">
        <span>貸出可能</span>
        <strong>${availableCount}件</strong>
      </div>
      <div class="shared-tool-summary-item is-in-use">
        <span>使用中</span>
        <strong>${inUseCount}件</strong>
      </div>
    `;


  if (
    availableCount === 0 &&
    inUseCount === 0 &&
    tools.length === 0
  ) {

    sharedToolMessage.textContent =
      "該当する工具はありません";

  } else if (
    availableCount === 0 &&
    inUseCount === 0
  ) {

    sharedToolMessage.textContent =
      "貸出可能または使用中の工具はありません。";

  } else if (availableCount === 0) {

    sharedToolMessage.textContent =
      "現在、倉庫に貸出可能な工具はありません。";

  } else {

    sharedToolMessage.textContent =
      "";
  }


  sharedToolResultSection
    .classList
    .remove(
      "hidden"
    );


  renderToolCards(
    tools
  );


  sharedToolResultSection
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

function renderToolCards(
  tools
) {

  const availableTools =
    tools.filter(isToolAvailableForCheckout);


  const inUseTools =
    tools.filter(isToolInUse);


  const otherTools =
    tools.filter(
      tool =>
        !isToolAvailableForCheckout(tool) &&
        !isToolInUse(tool)
    );


  sharedToolList.innerHTML =
    `
      <section class="shared-tool-result-group">
        <h3>貸出可能</h3>
        <div id="sharedToolAvailableList" class="shared-tool-result-group-list"></div>
      </section>
      <section class="shared-tool-result-group">
        <h3>使用中</h3>
        <div id="sharedToolInUseList" class="shared-tool-result-group-list"></div>
      </section>
      ${otherTools.length ? `
        <section class="shared-tool-result-group">
          <h3>その他</h3>
          <div id="sharedToolOtherList" class="shared-tool-result-group-list"></div>
        </section>
      ` : ""}
    `;


  const availableList =
    document.getElementById("sharedToolAvailableList");


  const inUseList =
    document.getElementById("sharedToolInUseList");


  const otherList =
    document.getElementById("sharedToolOtherList");


  if (!availableTools.length) {
    availableList.innerHTML =
      '<p class="schedule-empty-message">現在、倉庫に貸出可能な工具はありません。</p>';
  }


  if (!inUseTools.length) {
    inUseList.innerHTML =
      '<p class="schedule-empty-message">使用中の工具はありません。</p>';
  }


  const orderedTools =
    [
      ...availableTools,
      ...inUseTools,
      ...otherTools
    ];


  orderedTools.forEach(
    tool => {

      const card =
        document.createElement(
          "article"
        );


      const displayStatus =
        getDisplayStatus(
          tool
        );


      /* 1工具ごとの区切り */

      card.style.padding =
        "12px 0";

      card.style.borderBottom =
        "1px solid #d9e2ef";


      /* 管理番号 */

      const code =
        document.createElement(
          "div"
        );


      code.textContent =
        tool.management_code ||
        "-";


      code.style.display =
        "inline-block";

      code.style.padding =
        "5px 10px";

      code.style.borderRadius =
        "8px";

      code.style.backgroundColor =
        "#2563eb";

      code.style.color =
        "#ffffff";

      code.style.fontWeight =
        "700";

      code.style.fontSize =
        "0.95rem";


      /* 工具名 */

      const name =
        document.createElement(
          "div"
        );


      name.textContent =
        tool.tool_name ||
        "-";


      name.style.marginTop =
        "7px";

      name.style.fontWeight =
        "700";

      name.style.fontSize =
        "1.05rem";


      /* 現在地・状態 */

      const bottom =
        document.createElement(
          "div"
        );


      bottom.style.display =
        "flex";

      bottom.style.gap =
        "22px";

      bottom.style.marginTop =
        "5px";

      bottom.style.fontSize =
        "0.95rem";


      const location =
        document.createElement(
          "span"
        );


      location.textContent =
        displayStatus === "in_use"
          ? `使用現場：${getSiteName(tool)}`
          : `現在地：${getSiteName(tool)}`;


      const status =
        document.createElement(
          "span"
        );


      status.textContent =
        formatToolStatus(
          displayStatus
        );


      bottom.appendChild(
        location
      );


      bottom.appendChild(
        status
      );


      /* 操作ボタン */

      const actions =
        document.createElement(
          "div"
        );


      actions.className =
        "tool-item-actions";


      actions.style.marginTop =
        "10px";


      if (
        isToolAvailableForCheckout(tool)
      ) {

        actions.innerHTML =
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
        isToolInUse(tool)
      ) {

        actions.innerHTML =
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
            >
              返却
            </button>
          `;


        const returnButton =
          actions.querySelector(
            "button"
          );


        returnButton.addEventListener(
          "click",
          () => {

            returnTool(
              tool.id
            );
          }
        );
      }


      if (
        displayStatus ===
          "repair" ||
        displayStatus ===
          "stopped"
      ) {

        actions.innerHTML =
          `
            <a
              href="tool-detail.html?id=${tool.id}"
              class="admin-secondary-button"
            >
              詳細
            </a>
          `;
      }


      card.appendChild(
        code
      );


      card.appendChild(
        name
      );


      card.appendChild(
        bottom
      );


      card.appendChild(
        actions
      );


      const targetList =
        isToolAvailableForCheckout(tool)
          ? availableList
          : isToolInUse(tool)
          ? inUseList
          : otherList;


      targetList.appendChild(card);
    }
  );
}


/* =========================================
   返却
========================================= */

async function returnTool(
  toolId
) {

  const tool =
    sharedToolRecords.find(
      item =>
        Number(
          item.id
        ) ===
        Number(
          toolId
        )
    );


  if (
    !tool
  ) {

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


  if (
    !confirmed
  ) {

    return;
  }


  try {

    const loginUser =
      JSON.parse(
        localStorage.getItem(
          "portalLoginUser"
        ) ||
        "null"
      );


    const toolUrl =
      `${SUPABASE_URL}/rest/v1/tools` +
      `?id=eq.${tool.id}`;


    const toolResponse =
      await portalFetch(
        toolUrl,
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


    if (
      !toolResponse.ok
    ) {

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

          method:
            "POST",

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


    if (
      !historyResponse.ok
    ) {

      throw new Error(
        "返却履歴の保存に失敗しました"
      );
    }


    alert(
      "工具を返却しました"
    );


    await initialize();


    sharedToolResultSection
      .classList
      .add(
        "hidden"
      );


  } catch (error) {

    console.error(
      error
    );


    alert(
      error.message
    );
  }
}


/* =========================================
   イベント
========================================= */

toolGroupSelect
  .addEventListener(
    "change",
    updateToolNameSelect
  );


stockGroupSelect
  .addEventListener(
    "change",
    updateStockToolNameSelect
  );


toolSearchByCategoryButton
  .addEventListener(
    "click",
    searchByCategory
  );


toolSearchBySiteButton
  .addEventListener(
    "click",
    searchBySite
  );


toolSearchStockButton
  .addEventListener(
    "click",
    searchStock
  );


sharedToolSearchButton
  .addEventListener(
    "click",
    searchTools
  );


sharedToolSearch
  .addEventListener(
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


sharedToolResultClose
  .addEventListener(
    "click",
    () => {

      sharedToolResultSection
        .classList
        .add(
          "hidden"
        );
    }
  );


sharedToolQrStartButton
  .addEventListener(
    "click",
    startSharedToolQrReader
  );


sharedToolQrCancelButton
  .addEventListener(
    "click",
    cancelSharedToolQrReader
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

    console.error(
      error
    );


    alert(
      error.message
    );
  }
}


initialize();
