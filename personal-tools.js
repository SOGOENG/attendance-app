const SUPABASE_URL =
  "https://fgmvmbjnoyagnpygcbky.supabase.co";


const isMineMode =
  new URLSearchParams(
    window.location.search
  ).get("mine") === "1";


const personalToolEmployee =
  document.getElementById(
    "personalToolEmployee"
  );

const personalToolSearch =
  document.getElementById(
    "personalToolSearch"
  );

const personalToolSearchButton =
  document.getElementById(
    "personalToolSearchButton"
  );

const personalToolTotalCount =
  document.getElementById(
    "personalToolTotalCount"
  );

const personalToolResultSection =
  document.getElementById(
    "personalToolResultSection"
  );

const personalToolResultTitle =
  document.getElementById(
    "personalToolResultTitle"
  );

const personalToolList =
  document.getElementById(
    "personalToolList"
  );

const personalToolResultClose =
  document.getElementById(
    "personalToolResultClose"
  );

const personalToolQrStartButton =
  document.getElementById(
    "personalToolQrStartButton"
  );

const personalToolQrPanel =
  document.getElementById(
    "personalToolQrPanel"
  );

const personalToolQrCancelButton =
  document.getElementById(
    "personalToolQrCancelButton"
  );

const personalToolQrMessage =
  document.getElementById(
    "personalToolQrMessage"
  );


let employeeRecords = [];
let personalToolRecords = [];
let siteRecords = [];

const siteNameMap =
  new Map();

let personalToolQrScanner =
  null;

let personalToolQrScanning =
  false;

let personalToolQrProcessing =
  false;

let personalToolQrSessionId =
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


async function stopPersonalToolQrReader() {

  if (
    !personalToolQrScanner ||
    !personalToolQrScanning
  ) {

    return;
  }


  try {

    await personalToolQrScanner.stop();

  } catch (error) {

    console.warn(
      error
    );
  }


  personalToolQrScanning =
    false;


  try {

    personalToolQrScanner.clear();

  } catch (error) {

    console.warn(
      error
    );
  }


  personalToolQrScanner =
    null;
}


async function cancelPersonalToolQrReader() {

  personalToolQrSessionId +=
    1;


  await stopPersonalToolQrReader();


  personalToolQrProcessing =
    false;


  personalToolQrPanel.classList.add(
    "hidden"
  );


  personalToolQrStartButton.disabled =
    false;


  personalToolQrMessage.textContent =
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


async function handlePersonalToolQrResult(
  decodedText
) {

  if (personalToolQrProcessing) {
    return;
  }


  const toolId =
    getToolIdFromQrText(
      decodedText
    );


  if (!toolId) {

    personalToolQrMessage.textContent =
      "工具用QRコードではありません";

    return;
  }


  personalToolQrProcessing =
    true;


  await stopPersonalToolQrReader();


  personalToolQrPanel.classList.add(
    "hidden"
  );


  personalToolQrMessage.textContent =
    "工具情報を確認しています…";


  try {

    const tool =
      await loadQrTool(
        toolId
      );


    if (!tool) {

      personalToolQrMessage.textContent =
        "工具が見つかりません";

      return;
    }


    if (
      tool.ownership_type !==
      "personal"
    ) {

      personalToolQrMessage.textContent =
        "この工具は個人工具ではありません";

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


    personalToolQrMessage.textContent =
      error.message;


  } finally {

    personalToolQrProcessing =
      false;


    personalToolQrStartButton.disabled =
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


async function startPersonalToolQrReader() {

  if (
    personalToolQrScanning ||
    personalToolQrProcessing
  ) {

    return;
  }


  if (
    typeof Html5Qrcode ===
    "undefined"
  ) {

    personalToolQrMessage.textContent =
      "QR読取機能を読み込めませんでした";

    return;
  }


  personalToolQrPanel.classList.remove(
    "hidden"
  );


  personalToolQrStartButton.disabled =
    true;


  personalToolQrMessage.textContent =
    "カメラを起動しています…";


  const sessionId =
    personalToolQrSessionId +
    1;


  personalToolQrSessionId =
    sessionId;


  let scanner =
    null;


  try {

    scanner =
      new Html5Qrcode(
        "personalToolQrReader"
      );


    personalToolQrScanner =
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

        handlePersonalToolQrResult(
          decodedText
        );
      },
      () => {}
    );


    if (
      sessionId !==
      personalToolQrSessionId
    ) {

      await scanner.stop();


      scanner.clear();


      if (
        personalToolQrScanner ===
        scanner
      ) {

        personalToolQrScanner =
          null;
      }


      return;
    }


    personalToolQrScanning =
      true;


    personalToolQrMessage.textContent =
      "QRコードを枠内に合わせてください";

  } catch (error) {

    if (
      sessionId !==
      personalToolQrSessionId
    ) {

      return;
    }


    console.error(
      error
    );


    await stopPersonalToolQrReader();


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
      personalToolQrScanner ===
      scanner
    ) {

      personalToolQrScanner =
        null;
    }


    personalToolQrPanel.classList.add(
      "hidden"
    );


    personalToolQrMessage.textContent =
      getCameraErrorMessage(
        error
      );


    personalToolQrStartButton.disabled =
      false;
  }
}


/* =========================================
   HTMLエスケープ
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


/* =========================================
   社員名取得
========================================= */

function getEmployeeName(
  employeeId
) {

  if (!employeeId) {
    return "";
  }


  const employee =
    employeeRecords.find(
      item =>
        String(item.id) ===
        String(employeeId)
    );


  if (!employee) {
    return "";
  }


  return (
    employee.name ||
    employee.employee_name ||
    employee.full_name ||
    ""
  );
}


/* =========================================
   現場
========================================= */

function getSiteName(
  siteId
) {

  if (!siteId) {
    return "";
  }


  return (
    siteNameMap.get(
      String(siteId)
    ) ||
    ""
  );
}


function getCompactLocationText(
  tool
) {

  return tool.current_site_id
    ? "現場"
    : "倉庫";
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


  if (
    tool.current_site_id
  ) {

    return "in_use";
  }


  return (
    tool.status ||
    "available"
  );
}


/* =========================================
   社員プルダウン
========================================= */

function populateEmployeeOptions() {

  personalToolEmployee.innerHTML =
    `
      <option value="">
        すべて
      </option>
    `;


  const employeeIds =
    new Set(
      personalToolRecords
        .map(
          tool =>
            tool.assigned_employee_id
        )
        .filter(Boolean)
        .map(String)
    );


  employeeRecords
    .filter(
      employee =>
        employeeIds.has(
          String(employee.id)
        )
    )
    .forEach(
      employee => {

        const name =
          employee.name ||
          employee.employee_name ||
          employee.full_name ||
          "";


        if (!name) {
          return;
        }


        const option =
          document.createElement(
            "option"
          );


        option.value =
          employee.id;


        option.textContent =
          name;


        personalToolEmployee
          .appendChild(
            option
          );
      }
    );
}


/* =========================================
   社員読込
========================================= */

async function loadEmployees() {

  const response =
    await portalFetch(
      `${SUPABASE_URL}/rest/v1/employees?select=*&order=id.asc`
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
}


/* =========================================
   現場読込
========================================= */

async function loadSites() {

  const response =
    await portalFetch(
      `${SUPABASE_URL}/rest/v1/sites?select=id,display_name`
    );


  if (!response.ok) {

    console.error(
      await response.text()
    );


    throw new Error(
      "現場情報を読み込めませんでした"
    );
  }


  siteRecords =
    await response.json();


  siteNameMap.clear();


  siteRecords.forEach(
    site => {

      siteNameMap.set(
        String(site.id),
        site.display_name || ""
      );
    }
  );
}


/* =========================================
   ログイン中社員を選択
========================================= */

function selectLoginEmployee() {

  if (!isMineMode) {
    return;
  }


  const savedUser =
    localStorage.getItem(
      "portalLoginUser"
    );


  if (!savedUser) {
    throw new Error(
      "ログイン社員情報がありません"
    );
  }


  let loginUser;


  try {
    loginUser =
      JSON.parse(savedUser);

  } catch (error) {
    console.error(error);

    throw new Error(
      "ログイン社員情報を読み込めませんでした"
    );
  }


  const loginEmployeeId =
    String(loginUser.id ?? "");


  if (!loginEmployeeId) {
    throw new Error(
      "ログイン社員を特定できませんでした"
    );
  }


  const hasLoginEmployeeOption =
    Array.from(
      personalToolEmployee.options
    ).some(
      option =>
        option.value ===
        loginEmployeeId
    );


  if (!hasLoginEmployeeOption) {

    const loginEmployee =
      employeeRecords.find(
        employee =>
          String(employee.id) ===
          loginEmployeeId
      );


    const option =
      document.createElement(
        "option"
      );


    option.value =
      loginEmployeeId;


    option.textContent =
      loginEmployee?.name ||
      loginEmployee?.employee_name ||
      loginEmployee?.full_name ||
      loginUser.name ||
      "ログイン中の社員";


    personalToolEmployee
      .appendChild(option);
  }


  personalToolEmployee.value =
    loginEmployeeId;
}


/* =========================================
   個人工具読込
========================================= */

async function loadPersonalTools() {

  const response =
    await portalFetch(
      `${SUPABASE_URL}/rest/v1/tools` +
      `?select=*` +
      `&ownership_type=eq.personal` +
      `&order=tool_name.asc,management_code.asc`
    );


  if (!response.ok) {

    console.error(
      await response.text()
    );


    throw new Error(
      "個人工具を読み込めませんでした"
    );
  }


  personalToolRecords =
    await response.json();
}


/* =========================================
   一覧表示
========================================= */

function displayPersonalTools() {

  const employeeFilter =
    personalToolEmployee.value;


  const searchText =
    personalToolSearch.value
      .trim()
      .toLowerCase();


  const filteredTools =
    personalToolRecords.filter(
      tool => {


        if (
          employeeFilter &&
          String(
            tool.assigned_employee_id
          ) !==
          employeeFilter
        ) {

          return false;
        }


        if (searchText) {

          const employeeName =
            getEmployeeName(
              tool.assigned_employee_id
            );


          const siteName =
            getSiteName(
              tool.current_site_id
            );


          const searchableText =
            [
              tool.tool_group,
              tool.tool_name,
              tool.management_code,
              tool.specification,
              tool.manufacturer,
              tool.model_number,
              tool.serial_number,
              employeeName,
              siteName
            ]
              .filter(Boolean)
              .join(" ")
              .toLowerCase();


          if (
            !searchableText.includes(
              searchText
            )
          ) {

            return false;
          }
        }


        return true;
      }
    );


  personalToolResultTitle.textContent =
    `検索結果（${filteredTools.length}件）`;


  personalToolResultSection
    .classList
    .remove(
      "hidden"
    );


  personalToolList.innerHTML =
    "";


  if (
    filteredTools.length === 0
  ) {

    personalToolList.innerHTML =
      `
        <p class="schedule-empty-message">
          該当する工具はありません
        </p>
      `;

    return;
  }


  filteredTools.forEach(
    tool => {

      const card =
        document.createElement(
          "article"
        );


      card.style.padding =
        "12px 0";

      card.style.borderBottom =
        "1px solid #d9e2ef";


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


      const actions =
        document.createElement(
          "div"
        );


      actions.className =
        "tool-item-actions";


      actions.style.marginTop =
        "10px";


      actions.innerHTML =
        `
          <a
            href="tool-detail.html?id=${encodeURIComponent(
              tool.id
            )}"
            class="admin-secondary-button"
          >
            詳細
          </a>
        `;


      card.appendChild(
        code
      );


      card.appendChild(
        name
      );


      card.appendChild(
        actions
      );


      personalToolList.appendChild(
        card
      );
    }
  );
}


/* =========================================
   イベント
========================================= */

personalToolEmployee
  .addEventListener(
    "change",
    () => {

      personalToolResultSection
        .classList
        .add(
          "hidden"
        );
    }
  );


personalToolSearch
  .addEventListener(
    "input",
    () => {

      personalToolResultSection
        .classList
        .add(
          "hidden"
        );
    }
  );


personalToolSearchButton
  .addEventListener(
    "click",
    displayPersonalTools
  );


personalToolSearch
  .addEventListener(
    "keydown",
    event => {

      if (
        event.key ===
        "Enter"
      ) {

        displayPersonalTools();
      }
    }
  );


personalToolResultClose
  .addEventListener(
    "click",
    () => {

      personalToolResultSection
        .classList
        .add(
          "hidden"
        );
    }
  );


personalToolQrStartButton
  .addEventListener(
    "click",
    startPersonalToolQrReader
  );


personalToolQrCancelButton
  .addEventListener(
    "click",
    cancelPersonalToolQrReader
  );


/* =========================================
   初期処理
========================================= */

async function initializePersonalTools() {

  try {

    await Promise.all([
      loadEmployees(),
      loadSites(),
      loadPersonalTools()
    ]);


    populateEmployeeOptions();


    selectLoginEmployee();


    personalToolTotalCount.textContent =
      personalToolRecords.length;


    personalToolSearchButton.disabled =
      false;


    personalToolResultSection
      .classList
      .add(
        "hidden"
      );


  } catch (error) {

    console.error(
      error
    );


    personalToolList.innerHTML =
      `
        <p class="schedule-empty-message">
          ${escapeHtml(
            error.message
          )}
        </p>
      `;


    personalToolResultSection
      .classList
      .remove(
        "hidden"
      );
  }
}


initializePersonalTools();
