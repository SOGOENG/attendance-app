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

    const text =
      await response.text();

    console.error(
      text
    );


    throw new Error(
      "社員情報を読み込めませんでした"
    );
  }


  employeeRecords =
    await response.json();
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

    const text =
      await response.text();

    console.error(
      text
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


          const searchableText =
            [
              tool.tool_group,
              tool.tool_name,
              tool.management_code,
              tool.specification,
              tool.manufacturer,
              tool.model_number,
              tool.serial_number,
              employeeName
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
    filteredTools.length ===
    0
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

      const employeeName =
        getEmployeeName(
          tool.assigned_employee_id
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
              大分類：
              ${escapeHtml(
                tool.tool_group ||
                "未設定"
              )}
            </p>


            <p>
              管理番号：
              ${escapeHtml(
                tool.management_code ||
                "-"
              )}
            </p>


            <p>
              所有者：
              ${escapeHtml(
                employeeName ||
                "-"
              )}
            </p>


            <p>
              メーカー：
              ${escapeHtml(
                tool.manufacturer ||
                "-"
              )}
            </p>


            <p>
              型式：
              ${escapeHtml(
                tool.model_number ||
                "-"
              )}
            </p>


            <p>
              半年点検：
              ${
                tool.inspection_required
                  ? "対象"
                  : "対象外"
              }
            </p>

          </div>


          <div class="tool-item-actions">

            <a
              href="tool-detail.html?id=${encodeURIComponent(
                tool.id
              )}"
              class="admin-secondary-button"
            >
              詳細
            </a>

          </div>
        `;


      personalToolList
        .appendChild(
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

    await loadEmployees();

    await loadPersonalTools();

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