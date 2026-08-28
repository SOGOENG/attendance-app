const SUPABASE_URL =
  "https://fgmvmbjnoyagnpygcbky.supabase.co";


const openNewToolButton =
  document.getElementById(
    "openNewToolButton"
  );

const toolFormSection =
  document.getElementById(
    "toolFormSection"
  );

const toolFormTitle =
  document.getElementById(
    "toolFormTitle"
  );

const editingToolId =
  document.getElementById(
    "editingToolId"
  );


const toolGroup =
  document.getElementById(
    "toolGroup"
  );

const toolName =
  document.getElementById(
    "toolName"
  );

const toolSpecification =
  document.getElementById(
    "toolSpecification"
  );

const toolManagementCode =
  document.getElementById(
    "toolManagementCode"
  );

const toolOwnershipType =
  document.getElementById(
    "toolOwnershipType"
  );


const assignedEmployeeLabel =
  document.getElementById(
    "assignedEmployeeLabel"
  );

const toolAssignedEmployee =
  document.getElementById(
    "toolAssignedEmployee"
  );


const contractorOwnerLabel =
  document.getElementById(
    "contractorOwnerLabel"
  );

const toolOwnerCompanyName =
  document.getElementById(
    "toolOwnerCompanyName"
  );


const toolManufacturer =
  document.getElementById(
    "toolManufacturer"
  );

const toolModelNumber =
  document.getElementById(
    "toolModelNumber"
  );

const toolSerialNumber =
  document.getElementById(
    "toolSerialNumber"
  );

const toolPerformance =
  document.getElementById(
    "toolPerformance"
  );

const toolInspectionRequired =
  document.getElementById(
    "toolInspectionRequired"
  );

const toolInspectionCategory =
  document.getElementById(
    "toolInspectionCategory"
  );

const toolNote =
  document.getElementById(
    "toolNote"
  );


const saveToolButton =
  document.getElementById(
    "saveToolButton"
  );

const cancelToolEditButton =
  document.getElementById(
    "cancelToolEditButton"
  );

const stopToolButton =
  document.getElementById(
    "stopToolButton"
  );

const disposeToolButton =
  document.getElementById(
    "disposeToolButton"
  );

const toolMasterMessage =
  document.getElementById(
    "toolMasterMessage"
  );


const toolSearchGroup =
  document.getElementById(
    "toolSearchGroup"
  );

const toolSearchName =
  document.getElementById(
    "toolSearchName"
  );

const toolSearchOwnership =
  document.getElementById(
    "toolSearchOwnership"
  );

const toolMasterSearch =
  document.getElementById(
    "toolMasterSearch"
  );

const toolMasterList =
  document.getElementById(
    "toolMasterList"
  );

const toolSearchResultTitle =
  document.getElementById(
    "toolSearchResultTitle"
  );


let toolRecords = [];

let employeeRecords = [];

let newToolNameInput =
  null;



const TOOL_NAME_OPTIONS = {

  "配管加工機": [
    "旋盤",
    "電動オースター",
    "電動ベンダー",
    "Cuプレス",
    "Wプレス締付工具",
    "SUSWプレス締付工具",
    "ダブルプレスプレス式締付工具",
    "EFコントローラー",
    "エルメックス",
    "ナイスパンダ"
  ],

  "切断工具": [
    "バンドソー",
    "パイプソー",
    "パイプソー165S",
    "丸ノコ",
    "高速カッター",
    "セーパーソー",
    "ジグソー",
    "マイジグソー"
  ],

  "研磨・仕上げ工具": [
    "ベビーサンダー",
    "ディスクグラインダー",
    "ベルトサンダー"
  ],

  "穴あけ・斫り工具": [
    "ハンマードリル",
    "電機ドリル",
    "ダイヤテックドリル",
    "マグネットボーラー",
    "電子ボーラー",
    "斫り機",
    "ハツリ機",
    "斫ハンマー",
    "パンチャー"
  ],

  "締付・圧着工具": [
    "インパクトレンチ"
  ],

  "溶接機器": [
    "TIG溶接機",
    "エンジン溶接機",
    "エンジン発電機・兼用溶接機"
  ],

  "電源・配電機器": [
    "延長コード",
    "コードリール",
    "電工ドラム",
    "ポッキンブレーカー",
    "ポッキンブレーカ",
    "ポッキン延長ブレーカー",
    "ポッキン延長プラグ",
    "ブレーカー付延長コード",
    "漏電ブレーカー",
    "ビリビリガード",
    "変圧器",
    "トランス",
    "発電機"
  ],

  "ポンプ・空圧機器": [
    "テストポンプ",
    "水中ポンプ",
    "真空ポンプ",
    "エアーコンプレッサー",
    "コンプレッサー",
    "ベビーコンプレッサー",
    "冷媒回収器"
  ],

  "集塵・吸引": [
    "バキューム"
  ],

  "測定・探査": [
    "金属センサー",
    "レーザー",
    "三脚"
  ],

  "電動・汎用工具": [
    "送風機",
    "ブロワー",
    "投光器",
    "ホイスト",
    "カクハン機",
    "マルチツール",
    "ホットガン",
    "ホットエアーガン",
    "プラジェット",
    "ブラジェット"
  ],

  "その他": []
};


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


function showToolMessage(
  message
) {

  toolMasterMessage.textContent =
    message;
}


function clearToolMessage() {

  toolMasterMessage.textContent =
    "";
}


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


function populateEmployeeOptions() {

  toolAssignedEmployee.innerHTML =
    `
      <option value="">
        ---- 選択 ----
      </option>
    `;


  employeeRecords
    .filter(
      employee =>
        employee.active !== false
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

        toolAssignedEmployee
          .appendChild(
            option
          );
      }
    );
}


function updateOwnershipFields() {

  const ownership =
    toolOwnershipType.value;


  assignedEmployeeLabel.hidden =
    ownership !==
    "personal";


  contractorOwnerLabel.hidden =
    ownership !==
    "contractor";


  if (
    ownership !==
    "personal"
  ) {

    toolAssignedEmployee.value =
      "";
  }


  if (
    ownership !==
    "contractor"
  ) {

    toolOwnerCompanyName.value =
      "";
  }
}


function getToolNamesForGroup(
  group
) {

  const fixedNames =
    TOOL_NAME_OPTIONS[group] ||
    [];


  const registeredNames =
    toolRecords
      .filter(
        tool =>
          (
            !group ||
            tool.tool_group === group
          ) &&
          tool.tool_name
      )
      .map(
        tool =>
          tool.tool_name
      );


  return [
    ...new Set([
      ...fixedNames,
      ...registeredNames
    ])
  ]
    .sort(
      (a, b) =>
        a.localeCompare(
          b,
          "ja"
        )
    );
}


function updateToolNameOptions(
  selectedName = ""
) {

  const group =
    toolGroup.value;


  const names =
    getToolNamesForGroup(
      group
    );


  toolName.innerHTML =
    "";


  const defaultOption =
    document.createElement(
      "option"
    );

  defaultOption.value =
    "";

  defaultOption.textContent =
    group
      ? "---- 選択 ----"
      : "---- 先に大分類を選択 ----";


  toolName.appendChild(
    defaultOption
  );


  names.forEach(
    name => {

      const option =
        document.createElement(
          "option"
        );

      option.value =
        name;

      option.textContent =
        name;

      toolName.appendChild(
        option
      );
    }
  );


  if (
    selectedName &&
    !names.includes(
      selectedName
    )
  ) {

    const option =
      document.createElement(
        "option"
      );

    option.value =
      selectedName;

    option.textContent =
      selectedName;

    toolName.appendChild(
      option
    );
  }


  if (group) {

    const newOption =
      document.createElement(
        "option"
      );

    newOption.value =
      "__new__";

    newOption.textContent =
      "＋ 新しい工具名を入力";

    toolName.appendChild(
      newOption
    );
  }


  if (selectedName) {

    toolName.value =
      selectedName;
  }
}


/* =========================================
   検索用 工具名プルダウン
========================================= */

function updateSearchToolNameOptions() {

  const group =
    toolSearchGroup.value;


  let targetTools =
    toolRecords;


  /*
    大分類が選ばれている場合は
    その分類だけに絞る
  */

  if (group) {

    targetTools =
      toolRecords.filter(
        tool =>
          tool.tool_group ===
          group
      );
  }


  /*
    実際にDBに登録されている
    工具名から候補を作る
  */

  const names = [
    ...new Set(
      targetTools
        .map(
          tool =>
            tool.tool_name
        )
        .filter(Boolean)
    )
  ]
    .sort(
      (a, b) =>
        a.localeCompare(
          b,
          "ja"
        )
    );


  toolSearchName.innerHTML =
    `
      <option value="">
        すべて
      </option>
    `;


  names.forEach(
    name => {

      const option =
        document.createElement(
          "option"
        );

      option.value =
        name;

      option.textContent =
        name;

      toolSearchName
        .appendChild(
          option
        );
    }
  );
}


function showNewToolNameInput(
  value = ""
) {

  if (!newToolNameInput) {

    newToolNameInput =
      document.createElement(
        "input"
      );

    newToolNameInput.type =
      "text";

    newToolNameInput.id =
      "newToolNameInput";

    newToolNameInput.className =
      "admin-form-control";

    newToolNameInput.placeholder =
      "新しい工具名を入力";

    newToolNameInput.style.marginTop =
      "8px";


    toolName.parentElement
      .appendChild(
        newToolNameInput
      );
  }


  newToolNameInput.hidden =
    false;

  newToolNameInput.value =
    value;

  newToolNameInput.focus();
}


function hideNewToolNameInput() {

  if (!newToolNameInput) {
    return;
  }


  newToolNameInput.hidden =
    true;

  newToolNameInput.value =
    "";
}


function getToolNameValue() {

  if (
    toolName.value ===
    "__new__"
  ) {

    return newToolNameInput
      ? newToolNameInput.value.trim()
      : "";
  }


  return toolName.value.trim();
}


function openToolForm() {

  toolFormSection.hidden =
    false;
}


function closeToolForm() {

  toolFormSection.hidden =
    true;

  resetToolForm();

  clearToolMessage();
}


function startNewTool() {

  resetToolForm();

  openToolForm();


  setTimeout(
    () => {

      toolFormSection
        .scrollIntoView({
          behavior:
            "smooth",

          block:
            "start"
        });

    },
    50
  );
}


function createToolData() {

  const ownership =
    toolOwnershipType.value;


  return {

    tool_group:
      toolGroup.value ||
      null,

    management_code:
      toolManagementCode.value
        .trim(),

    tool_name:
      getToolNameValue(),

    specification:
      toolSpecification.value
        .trim() ||
      null,

    ownership_type:
      ownership,

    assigned_employee_id:
      ownership ===
      "personal"
        ? (
            toolAssignedEmployee.value
              ? Number(
                  toolAssignedEmployee.value
                )
              : null
          )
        : null,

    owner_company_name:
      ownership ===
      "contractor"
        ? (
            toolOwnerCompanyName.value
              .trim() ||
            null
          )
        : null,

    checkout_managed:
      ownership !==
      "contractor",

    manufacturer:
      toolManufacturer.value
        .trim() ||
      null,

    model_number:
      toolModelNumber.value
        .trim() ||
      null,

    serial_number:
      toolSerialNumber.value
        .trim() ||
      null,

    performance:
      toolPerformance.value
        .trim() ||
      null,

    inspection_required:
      toolInspectionRequired.value ===
      "true",

    inspection_category:
      toolInspectionCategory.value ||
      null,

    note:
      toolNote.value
        .trim() ||
      null,

    updated_at:
      new Date()
        .toISOString()
  };
}


function validateTool() {

  if (!toolGroup.value) {

    throw new Error(
      "大分類を選択してください"
    );
  }


  if (!getToolNameValue()) {

    throw new Error(
      "工具名を入力してください"
    );
  }


  if (
    !toolManagementCode.value.trim()
  ) {

    throw new Error(
      "管理番号を入力してください"
    );
  }


  if (
    toolOwnershipType.value ===
      "personal" &&
    !toolAssignedEmployee.value
  ) {

    throw new Error(
      "社員名を選択してください"
    );
  }


  if (
    toolOwnershipType.value ===
      "contractor" &&
    !toolOwnerCompanyName.value.trim()
  ) {

    throw new Error(
      "協力業者名を入力してください"
    );
  }
}


async function saveTool() {

  clearToolMessage();


  try {

    validateTool();

  } catch (error) {

    showToolMessage(
      error.message
    );

    return;
  }


  const toolId =
    editingToolId.value;


  const isEditing =
    Boolean(toolId);


  const record =
    createToolData();


  const confirmed =
    window.confirm(
      isEditing
        ? "工具情報を保存しますか？"
        : "工具を登録しますか？"
    );


  if (!confirmed) {
    return;
  }


  try {

    let url =
      `${SUPABASE_URL}/rest/v1/tools`;

    let method =
      "POST";


    if (isEditing) {

      url +=
        `?id=eq.${toolId}`;

      method =
        "PATCH";
    }


    const response =
      await portalFetch(
        url,
        {

          method,

          headers: {

            "Content-Type":
              "application/json",

            Prefer:
              "return=minimal"
          },

          body:
            JSON.stringify(
              record
            )
        }
      );


    if (!response.ok) {

      const text =
        await response.text();

      console.error(
        text
      );


      throw new Error(
        isEditing
          ? "工具情報を保存できませんでした"
          : "工具を登録できませんでした"
      );
    }


    await loadTools();


    closeToolForm();


    alert(
      isEditing
        ? "工具情報を保存しました"
        : "工具を登録しました"
    );


  } catch (error) {

    console.error(
      error
    );

    showToolMessage(
      error.message
    );
  }
}


function startToolEdit(
  tool
) {

  resetToolForm();

  openToolForm();


  editingToolId.value =
    tool.id;


  toolFormTitle.textContent =
    "工具情報の修正";


  toolGroup.value =
    tool.tool_group ||
    "";


  updateToolNameOptions(
    tool.tool_name ||
    ""
  );


  toolSpecification.value =
    tool.specification ||
    "";


  toolManagementCode.value =
    tool.management_code ||
    "";


  toolOwnershipType.value =
    tool.ownership_type ||
    "shared";


  updateOwnershipFields();


  toolAssignedEmployee.value =
    tool.assigned_employee_id
      ? String(
          tool.assigned_employee_id
        )
      : "";


  toolOwnerCompanyName.value =
    tool.owner_company_name ||
    "";


  toolManufacturer.value =
    tool.manufacturer ||
    "";


  toolModelNumber.value =
    tool.model_number ||
    "";


  toolSerialNumber.value =
    tool.serial_number ||
    "";


  toolPerformance.value =
    tool.performance ||
    "";


  toolInspectionRequired.value =
    String(
      tool.inspection_required
    );


  const currentCategory =
    tool.inspection_category ||
    "";


  if (
    currentCategory &&
    ![
      ...toolInspectionCategory.options
    ].some(
      option =>
        option.value ===
        currentCategory
    )
  ) {

    const option =
      document.createElement(
        "option"
      );

    option.value =
      currentCategory;

    option.textContent =
      currentCategory;

    toolInspectionCategory
      .appendChild(
        option
      );
  }


  toolInspectionCategory.value =
    currentCategory;


  toolNote.value =
    tool.note ||
    "";


  saveToolButton.textContent =
    "保存する";


  if (
    tool.status ===
    "disposed"
  ) {

    stopToolButton.hidden =
      true;

    disposeToolButton.hidden =
      true;

  } else {

    stopToolButton.hidden =
      false;

    disposeToolButton.hidden =
      false;
  }


  setTimeout(
    () => {

      toolFormSection
        .scrollIntoView({
          behavior:
            "smooth",

          block:
            "start"
        });

    },
    50
  );
}


function resetToolForm() {

  editingToolId.value =
    "";


  toolFormTitle.textContent =
    "工具登録";


  toolGroup.value =
    "";


  updateToolNameOptions();


  hideNewToolNameInput();


  toolSpecification.value =
    "";


  toolManagementCode.value =
    "";


  toolOwnershipType.value =
    "shared";


  toolAssignedEmployee.value =
    "";


  toolOwnerCompanyName.value =
    "";


  updateOwnershipFields();


  toolManufacturer.value =
    "";


  toolModelNumber.value =
    "";


  toolSerialNumber.value =
    "";


  toolPerformance.value =
    "";


  toolInspectionRequired.value =
    "false";


  toolInspectionCategory.value =
    "";


  toolNote.value =
    "";


  saveToolButton.textContent =
    "登録する";


  stopToolButton.hidden =
    true;


  disposeToolButton.hidden =
    true;
}


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


async function stopTool() {

  const toolId =
    editingToolId.value;


  if (!toolId) {
    return;
  }


  const confirmed =
    window.confirm(
      `${getToolNameValue()}を使用停止にしますか？`
    );


  if (!confirmed) {
    return;
  }


  const response =
    await portalFetch(
      `${SUPABASE_URL}/rest/v1/tools?id=eq.${toolId}`,
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

            status:
              "stopped",

            active:
              false,

            updated_at:
              new Date()
                .toISOString()
          })
      }
    );


  if (!response.ok) {

    alert(
      "使用停止にできませんでした"
    );

    return;
  }


  await loadTools();

  closeToolForm();
}


async function disposeTool() {

  const toolId =
    editingToolId.value;


  if (!toolId) {
    return;
  }


  const reason =
    window.prompt(
      "廃棄理由を入力してください"
    );


  if (reason === null) {
    return;
  }


  if (!reason.trim()) {

    alert(
      "廃棄理由を入力してください"
    );

    return;
  }


  const today =
    new Date();


  const disposedDate =
    `${today.getFullYear()}-` +
    `${String(
      today.getMonth() + 1
    ).padStart(
      2,
      "0"
    )}-` +
    `${String(
      today.getDate()
    ).padStart(
      2,
      "0"
    )}`;


  const response =
    await portalFetch(
      `${SUPABASE_URL}/rest/v1/tools?id=eq.${toolId}`,
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

            status:
              "disposed",

            active:
              false,

            disposed_at:
              disposedDate,

            disposal_reason:
              reason.trim(),

            updated_at:
              new Date()
                .toISOString()
          })
      }
    );


  if (!response.ok) {

    alert(
      "廃棄にできませんでした"
    );

    return;
  }


  await loadTools();

  closeToolForm();
}


async function loadEmployees() {

  const response =
    await portalFetch(
      `${SUPABASE_URL}/rest/v1/employees?select=*&order=id.asc`
    );


  if (!response.ok) {

    throw new Error(
      "社員情報を読み込めませんでした"
    );
  }


  employeeRecords =
    await response.json();


  populateEmployeeOptions();
}


async function loadTools() {

  const response =
    await portalFetch(
      `${SUPABASE_URL}/rest/v1/tools?select=*&order=tool_name.asc,management_code.asc`
    );


  if (!response.ok) {

    throw new Error(
      "工具情報を読み込めませんでした"
    );
  }


  toolRecords =
    await response.json();


  updateToolNameOptions();

  updateSearchToolNameOptions();

  displayTools();
}


function displayTools() {

  const groupFilter =
    toolSearchGroup.value;


  const nameFilter =
    toolSearchName.value;


  const ownershipFilter =
    toolSearchOwnership.value;


  const searchText =
    toolMasterSearch.value
      .trim()
      .toLowerCase();


  const filteredTools =
    toolRecords.filter(
      tool => {


        if (
          groupFilter &&
          tool.tool_group !==
            groupFilter
        ) {

          return false;
        }


        if (
          nameFilter &&
          tool.tool_name !==
            nameFilter
        ) {

          return false;
        }


        if (
          ownershipFilter &&
          tool.ownership_type !==
            ownershipFilter
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
              tool.performance,
              employeeName,
              tool.owner_company_name
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


  toolSearchResultTitle.textContent =
    `検索結果（${filteredTools.length}件）`;


  toolMasterList.innerHTML =
    "";


  if (
    filteredTools.length ===
    0
  ) {

    toolMasterList.innerHTML =
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


      card.className =
        "tool-item-card";


      const ownershipText =
        tool.ownership_type ===
          "personal"
          ? "個人（会社社員）"

          : tool.ownership_type ===
            "contractor"
            ? "協力業者"

            : "共有（会社）";


      const employeeName =
        getEmployeeName(
          tool.assigned_employee_id
        );


      const ownerText =
        tool.ownership_type ===
          "personal"
          ? employeeName

          : tool.ownership_type ===
            "contractor"
            ? (
                tool.owner_company_name ||
                ""
              )

            : "";


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
                tool.management_code
              )}
            </p>

            <p>
              所有区分：
              ${escapeHtml(
                ownershipText
              )}
            </p>

            ${
              ownerText
                ? `
                  <p>
                    所有者：
                    ${escapeHtml(
                      ownerText
                    )}
                  </p>
                `
                : ""
            }

            <p>
              状態：
              ${escapeHtml(
                formatToolStatus(
                  tool.status
                )
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

            <button
              type="button"
              class="admin-secondary-button edit-tool-button"
            >
              編集
            </button>

          </div>
        `;


      card
        .querySelector(
          ".edit-tool-button"
        )
        .addEventListener(
          "click",
          () => {

            startToolEdit(
              tool
            );
          }
        );


      toolMasterList
        .appendChild(
          card
        );
    }
  );
}


openNewToolButton
  .addEventListener(
    "click",
    startNewTool
  );


cancelToolEditButton
  .addEventListener(
    "click",
    closeToolForm
  );


toolGroup
  .addEventListener(
    "change",
    () => {

      updateToolNameOptions();

      hideNewToolNameInput();
    }
  );


toolName
  .addEventListener(
    "change",
    () => {

      if (
        toolName.value ===
        "__new__"
      ) {

        showNewToolNameInput();

      } else {

        hideNewToolNameInput();
      }
    }
  );


toolOwnershipType
  .addEventListener(
    "change",
    updateOwnershipFields
  );


saveToolButton
  .addEventListener(
    "click",
    saveTool
  );


stopToolButton
  .addEventListener(
    "click",
    stopTool
  );


disposeToolButton
  .addEventListener(
    "click",
    disposeTool
  );


/* 大分類変更 → 工具名候補変更 */
toolSearchGroup
  .addEventListener(
    "change",
    () => {

      updateSearchToolNameOptions();

      toolSearchName.value =
        "";

      displayTools();
    }
  );


toolSearchName
  .addEventListener(
    "change",
    displayTools
  );


toolSearchOwnership
  .addEventListener(
    "change",
    displayTools
  );


toolMasterSearch
  .addEventListener(
    "input",
    displayTools
  );


async function initializeToolMaster() {

  try {

    updateOwnershipFields();

    updateToolNameOptions();


    await loadEmployees();

    await loadTools();


  } catch (error) {

    console.error(
      error
    );


    toolMasterList.innerHTML =
      `
        <p class="schedule-empty-message">
          ${escapeHtml(
            error.message
          )}
        </p>
      `;
  }
}


initializeToolMaster();