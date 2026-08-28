const SUPABASE_URL =
  "https://fgmvmbjnoyagnpygcbky.supabase.co";


const personalToolEmployee =
  document.getElementById(
    "personalToolEmployee"
  );

const personalToolSearch =
  document.getElementById(
    "personalToolSearch"
  );

const personalToolResultTitle =
  document.getElementById(
    "personalToolResultTitle"
  );

const personalToolList =
  document.getElementById(
    "personalToolList"
  );


let employeeRecords = [];
let personalToolRecords = [];
let siteRecords = [];

const siteNameMap =
  new Map();


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
    `個人工具一覧（${filteredTools.length}件）`;


  personalToolList.innerHTML =
    "";


  if (
    filteredTools.length === 0
  ) {

    personalToolList.innerHTML =
      `
        <p class="schedule-empty-message">
          該当する個人工具はありません
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


      const locationText =
        getCompactLocationText(
          tool
        );


      const statusText =
        formatToolStatus(
          getDisplayStatus(
            tool
          )
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
        locationText;


      const status =
        document.createElement(
          "span"
        );


      status.textContent =
        statusText;


      bottom.appendChild(
        location
      );


      bottom.appendChild(
        status
      );


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
        bottom
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
    displayPersonalTools
  );


personalToolSearch
  .addEventListener(
    "input",
    displayPersonalTools
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


    displayPersonalTools();


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
  }
}


initializePersonalTools();