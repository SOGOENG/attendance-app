/* =========================================
   Supabase接続設定
========================================= */

const SUPABASE_URL =
  "https://fgmvmbjnoyagnpygcbky.supabase.co";


/* =========================================
   HTML要素
========================================= */

const moveToolName =
  document.getElementById(
    "moveToolName"
  );

const moveToolCode =
  document.getElementById(
    "moveToolCode"
  );

const moveCurrentSite =
  document.getElementById(
    "moveCurrentSite"
  );

const moveCurrentEmployee =
  document.getElementById(
    "moveCurrentEmployee"
  );

const moveSite =
  document.getElementById(
    "moveSite"
  );

const moveEmployee =
  document.getElementById(
    "moveEmployee"
  );

const moveNote =
  document.getElementById(
    "moveNote"
  );

const moveButton =
  document.getElementById(
    "moveButton"
  );

const moveMessage =
  document.getElementById(
    "moveMessage"
  );


/* =========================================
   現在データ
========================================= */

let currentTool = null;

const siteNameMap =
  new Map();

const employeeNameMap =
  new Map();


/* =========================================
   URLから工具ID取得
========================================= */

function getToolIdFromUrl() {
  const params =
    new URLSearchParams(
      window.location.search
    );

  return params.get("id");
}


/* =========================================
   ログインユーザー取得
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
    return JSON.parse(
      savedUser
    );

  } catch (error) {
    console.error(error);

    return null;
  }
}


/* =========================================
   現場一覧読込
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

  const sites =
    await response.json();

  siteNameMap.clear();

  sites.forEach(site => {
    siteNameMap.set(
      String(site.id),
      site.display_name
    );

    const option =
      document.createElement(
        "option"
      );

    option.value =
      site.id;

    option.textContent =
      site.display_name;

    moveSite.appendChild(
      option
    );
  });
}


/* =========================================
   社員一覧読込
========================================= */

async function loadEmployees() {
  const url =
    `${SUPABASE_URL}/rest/v1/employees` +
    `?select=id,name,active` +
    `&active=eq.true` +
    `&order=name.asc`;

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

  const employees =
    await response.json();

  employeeNameMap.clear();

  employees.forEach(employee => {
    employeeNameMap.set(
      String(employee.id),
      employee.name
    );

    const option =
      document.createElement(
        "option"
      );

    option.value =
      employee.id;

    option.textContent =
      employee.name;

    moveEmployee.appendChild(
      option
    );
  });
}


/* =========================================
   工具情報読込
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

    console.error(errorText);

    throw new Error(
      "工具情報を読み込めませんでした"
    );
  }

  const tools =
    await response.json();

  if (tools.length === 0) {
    throw new Error(
      "工具が見つかりません"
    );
  }

  currentTool =
    tools[0];

  moveToolName.textContent =
    `${currentTool.tool_name}` +
    `${
      currentTool.specification
        ? ` ${currentTool.specification}`
        : ""
    }`;

  moveToolCode.textContent =
    `管理番号：${currentTool.management_code}`;

  const currentSiteName =
    currentTool.current_site_id
      ? (
          siteNameMap.get(
            String(
              currentTool.current_site_id
            )
          ) || "-"
        )
      : "倉庫";

  const currentEmployeeName =
    currentTool.assigned_employee_id
      ? (
          employeeNameMap.get(
            String(
              currentTool.assigned_employee_id
            )
          ) || "-"
        )
      : "-";

  moveCurrentSite.textContent =
    `現在地：${currentSiteName}`;

  moveCurrentEmployee.textContent =
    `担当者：${currentEmployeeName}`;

  if (
    currentTool.current_site_id
  ) {
    moveSite.value =
      String(
        currentTool.current_site_id
      );
  }

  if (
    currentTool.assigned_employee_id
  ) {
    moveEmployee.value =
      String(
        currentTool.assigned_employee_id
      );
  }
}


/* =========================================
   移動実行
========================================= */

async function moveTool() {
  moveMessage.textContent =
    "";

  if (!currentTool) {
    moveMessage.textContent =
      "工具情報がありません";

    return;
  }

  if (!moveSite.value) {
    moveMessage.textContent =
      "移動先現場を選択してください";

    return;
  }

  if (!moveEmployee.value) {
    moveMessage.textContent =
      "担当者を選択してください";

    return;
  }

  const newSiteId =
    Number(
      moveSite.value
    );

  const newEmployeeId =
    Number(
      moveEmployee.value
    );

  const oldSiteId =
    currentTool.current_site_id;

  const oldEmployeeId =
    currentTool.assigned_employee_id;

  if (
    String(oldSiteId || "") ===
      String(newSiteId) &&
    String(oldEmployeeId || "") ===
      String(newEmployeeId)
  ) {
    moveMessage.textContent =
      "現在地と担当者が変更されていません";

    return;
  }

  const newSiteName =
    siteNameMap.get(
      String(newSiteId)
    ) || "";

  const newEmployeeName =
    employeeNameMap.get(
      String(newEmployeeId)
    ) || "";

  const confirmed =
    window.confirm(
      `${currentTool.tool_name}を\n` +
      `${newSiteName}／${newEmployeeName}\n` +
      `へ移動しますか？`
    );

  if (!confirmed) {
    return;
  }

  moveButton.disabled =
    true;

  moveButton.textContent =
    "移動中...";

  try {
    const loginUser =
      getLoginUser();


    /*
      tools更新
    */

    const toolUrl =
      `${SUPABASE_URL}/rest/v1/tools` +
      `?id=eq.${currentTool.id}`;

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
                newSiteId,

              assigned_employee_id:
                newEmployeeId,

              status:
                "in_use",

              updated_at:
                new Date()
                  .toISOString()
            })
        }
      );

    if (!toolResponse.ok) {
      const errorText =
        await toolResponse.text();

      console.error(
        errorText
      );

      throw new Error(
        "工具の移動に失敗しました"
      );
    }


    /*
      履歴追加
    */

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
                currentTool.id,

              action_type:
                "move",

              from_site_id:
                oldSiteId || null,

              to_site_id:
                newSiteId,

              from_employee_id:
                oldEmployeeId || null,

              to_employee_id:
                newEmployeeId,

              operated_by_employee_id:
                loginUser
                  ? loginUser.id
                  : null,

              note:
                moveNote.value
                  .trim() || null
            })
        }
      );

    if (!historyResponse.ok) {
      const errorText =
        await historyResponse.text();

      console.error(
        errorText
      );

      throw new Error(
        "移動履歴の保存に失敗しました"
      );
    }

    alert(
      "工具を移動しました"
    );

    window.location.href =
      "shared-tools.html";

  } catch (error) {
    console.error(error);

    moveMessage.textContent =
      error.message;

  } finally {
    moveButton.disabled =
      false;

    moveButton.textContent =
      "移動する";
  }
}


/* =========================================
   イベント
========================================= */

moveButton.addEventListener(
  "click",
  moveTool
);


/* =========================================
   初期表示
========================================= */

async function initialize() {
  try {
    await Promise.all([
      loadSites(),
      loadEmployees()
    ]);

    await loadTool();

  } catch (error) {
    console.error(error);

    moveMessage.textContent =
      error.message;
  }
}

initialize();