/* =========================================
   Supabase接続設定
========================================= */

const SUPABASE_URL =
  "https://fgmvmbjnoyagnpygcbky.supabase.co";


/* =========================================
   HTML要素
========================================= */

const checkoutToolName =
  document.getElementById(
    "checkoutToolName"
  );

const checkoutToolCode =
  document.getElementById(
    "checkoutToolCode"
  );

const checkoutSite =
  document.getElementById(
    "checkoutSite"
  );

const checkoutEmployee =
  document.getElementById(
    "checkoutEmployee"
  );

const checkoutNote =
  document.getElementById(
    "checkoutNote"
  );

const checkoutButton =
  document.getElementById(
    "checkoutButton"
  );

const checkoutMessage =
  document.getElementById(
    "checkoutMessage"
  );


/* =========================================
   現在の工具
========================================= */

let currentTool = null;


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

  checkoutToolName.textContent =
    `${currentTool.tool_name}` +
    `${
      currentTool.specification
        ? ` ${currentTool.specification}`
        : ""
    }`;

  checkoutToolCode.textContent =
    `管理番号：${currentTool.management_code}`;
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

  sites.forEach(site => {
    const option =
      document.createElement(
        "option"
      );

    option.value =
      site.id;

    option.textContent =
      site.display_name;

    checkoutSite.appendChild(
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
    throw new Error(
      "社員一覧を読み込めませんでした"
    );
  }

  const employees =
    await response.json();

  employees.forEach(employee => {
    const option =
      document.createElement(
        "option"
      );

    option.value =
      employee.id;

    option.textContent =
      employee.name;

    checkoutEmployee.appendChild(
      option
    );
  });
}


/* =========================================
   持出実行
========================================= */

async function checkoutTool() {
  checkoutMessage.textContent =
    "";

  if (!currentTool) {
    checkoutMessage.textContent =
      "工具情報がありません";

    return;
  }

  if (!checkoutSite.value) {
    checkoutMessage.textContent =
      "現場を選択してください";

    return;
  }

  if (!checkoutEmployee.value) {
    checkoutMessage.textContent =
      "持出者を選択してください";

    return;
  }

  const confirmed =
    window.confirm(
      `${currentTool.tool_name}を持ち出しますか？`
    );

  if (!confirmed) {
    return;
  }

  checkoutButton.disabled =
    true;

  checkoutButton.textContent =
    "登録中...";

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
                Number(
                  checkoutSite.value
                ),

              assigned_employee_id:
                Number(
                  checkoutEmployee.value
                ),

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
        "工具の持出登録に失敗しました"
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
                "checkout",

              from_site_id:
                null,

              to_site_id:
                Number(
                  checkoutSite.value
                ),

              from_employee_id:
                null,

              to_employee_id:
                Number(
                  checkoutEmployee.value
                ),

              operated_by_employee_id:
                loginUser
                  ? loginUser.id
                  : null,

              note:
                checkoutNote.value
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
        "持出履歴の保存に失敗しました"
      );
    }

    alert(
      "工具を持ち出しました"
    );

    window.location.href =
      "shared-tools.html";

  } catch (error) {
    console.error(error);

    checkoutMessage.textContent =
      error.message;

  } finally {
    checkoutButton.disabled =
      false;

    checkoutButton.textContent =
      "持出する";
  }
}


/* =========================================
   イベント
========================================= */

checkoutButton.addEventListener(
  "click",
  checkoutTool
);


/* =========================================
   初期表示
========================================= */

async function initialize() {
  try {
    await loadTool();

    await Promise.all([
      loadSites(),
      loadEmployees()
    ]);

  } catch (error) {
    console.error(error);

    checkoutMessage.textContent =
      error.message;
  }
}

initialize();