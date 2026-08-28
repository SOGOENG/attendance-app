const SUPABASE_URL =
  "https://fgmvmbjnoyagnpygcbky.supabase.co";


/* =========================================
   HTML要素
========================================= */

const openNewToolButton =
  document.getElementById("openNewToolButton");

const toolFormSection =
  document.getElementById("toolFormSection");

const toolFormTitle =
  document.getElementById("toolFormTitle");

const editingToolId =
  document.getElementById("editingToolId");

const toolGroup =
  document.getElementById("toolGroup");

const toolName =
  document.getElementById("toolName");

const toolSpecification =
  document.getElementById("toolSpecification");

const toolManagementCode =
  document.getElementById("toolManagementCode");

const toolOwnershipType =
  document.getElementById("toolOwnershipType");

const assignedEmployeeLabel =
  document.getElementById("assignedEmployeeLabel");

const toolAssignedEmployee =
  document.getElementById("toolAssignedEmployee");

const contractorOwnerLabel =
  document.getElementById("contractorOwnerLabel");

const toolOwnerCompanyName =
  document.getElementById("toolOwnerCompanyName");

const toolManufacturer =
  document.getElementById("toolManufacturer");

const toolModelNumber =
  document.getElementById("toolModelNumber");

const toolSerialNumber =
  document.getElementById("toolSerialNumber");

const toolPerformance =
  document.getElementById("toolPerformance");

const toolInspectionRequired =
  document.getElementById("toolInspectionRequired");

const toolInspectionCategory =
  document.getElementById("toolInspectionCategory");

const toolInspectionCategoryLabel =
  document.getElementById("toolInspectionCategoryLabel");

const toolNote =
  document.getElementById("toolNote");

const saveToolButton =
  document.getElementById("saveToolButton");

const cancelToolEditButton =
  document.getElementById("cancelToolEditButton");

const stopToolButton =
  document.getElementById("stopToolButton");

const disposeToolButton =
  document.getElementById("disposeToolButton");

const toolMasterMessage =
  document.getElementById("toolMasterMessage");

const toolSearchGroup =
  document.getElementById("toolSearchGroup");

const toolSearchName =
  document.getElementById("toolSearchName");

const toolSearchOwnership =
  document.getElementById("toolSearchOwnership");

const toolMasterSearch =
  document.getElementById("toolMasterSearch");

const toolMasterList =
  document.getElementById("toolMasterList");

const toolSearchResultTitle =
  document.getElementById("toolSearchResultTitle");


/* =========================================
   データ
========================================= */

let toolRecords = [];
let employeeRecords = [];
let siteRecords = [];

let newToolNameInput = null;

let latheSizeLabel = null;
let latheSizeSelect = null;


/* =========================================
   大分類別 工具名候補
========================================= */

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

  "充電工具": [
    "充電インパクト",
    "充電ドライバー",
    "充電ハンマードリル",
    "充電全ねじカッター",
    "充電パンチャー",
    "充電セーパーソー"
  ],

  "その他": []
};


/* =========================================
   新規充電工具用 管理番号
========================================= */

const BATTERY_TOOL_PREFIXES = {

  "充電インパクト":
    "BI",

  "充電ドライバー":
    "BD",

  "充電ハンマードリル":
    "BHD",

  "充電全ねじカッター":
    "BRC",

  "充電パンチャー":
    "BP",

  "充電セーパーソー":
    "BRS"
};


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


function showToolMessage(message) {

  toolMasterMessage.textContent =
    message;
}


function clearToolMessage() {

  toolMasterMessage.textContent =
    "";
}


/* =========================================
   社員
========================================= */

function getEmployeeName(employeeId) {

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


        toolAssignedEmployee.appendChild(
          option
        );
      }
    );
}


/* =========================================
   現場
========================================= */

function getSiteName(siteId) {

  if (!siteId) {
    return "";
  }


  const site =
    siteRecords.find(
      item =>
        String(item.id) ===
        String(siteId)
    );


  if (!site) {
    return "";
  }


  return (
    site.display_name ||
    site.site_name ||
    site.name ||
    ""
  );
}


function getCurrentLocationText(tool) {

  if (
    tool.current_site_id
  ) {

    return (
      getSiteName(
        tool.current_site_id
      ) ||
      "現場"
    );
  }


  if (
    tool.ownership_type ===
    "shared"
  ) {

    return "倉庫";
  }


  return "-";
}


/* =========================================
   所有区分
========================================= */

function updateOwnershipFields() {

  const ownership =
    toolOwnershipType.value;


  if (
    ownership ===
    "personal"
  ) {

    assignedEmployeeLabel.style.display =
      "block";

  } else {

    assignedEmployeeLabel.style.display =
      "none";

    toolAssignedEmployee.value =
      "";
  }


  if (
    ownership ===
    "contractor"
  ) {

    contractorOwnerLabel.style.display =
      "block";

  } else {

    contractorOwnerLabel.style.display =
      "none";

    toolOwnerCompanyName.value =
      "";
  }
}


/* =========================================
   半年点検
========================================= */

function updateInspectionFields() {

  const isBatteryTool =
    toolGroup.value ===
    "充電工具";


  if (isBatteryTool) {

    toolInspectionRequired.value =
      "false";

    toolInspectionCategory.value =
      "";

    toolInspectionRequired.disabled =
      true;


    if (
      toolInspectionCategoryLabel
    ) {

      toolInspectionCategoryLabel
        .style.display =
        "none";
    }

  } else {

    toolInspectionRequired.disabled =
      false;


    if (
      toolInspectionCategoryLabel
    ) {

      toolInspectionCategoryLabel
        .style.display =
        "block";
    }
  }
}


/* =========================================
   管理番号解析
========================================= */

function parseManagementCode(
  managementCode
) {

  const value =
    String(
      managementCode ||
      ""
    ).trim();


  const match =
    value.match(
      /^(.+)-(\d+)$/
    );


  if (!match) {

    return null;
  }


  return {

    prefix:
      match[1],

    number:
      Number(
        match[2]
      )
  };
}


/* =========================================
   既存工具から接頭辞を取得
========================================= */

function findExistingPrefix(
  toolNameValue
) {

  const prefixCount =
    new Map();


  toolRecords
    .filter(
      tool =>
        tool.tool_name ===
        toolNameValue
    )
    .forEach(
      tool => {

        const parsed =
          parseManagementCode(
            tool.management_code
          );


        if (!parsed) {
          return;
        }


        const currentCount =
          prefixCount.get(
            parsed.prefix
          ) || 0;


        prefixCount.set(
          parsed.prefix,
          currentCount + 1
        );
      }
    );


  if (
    prefixCount.size ===
    0
  ) {

    return null;
  }


  return [
    ...prefixCount.entries()
  ]
    .sort(
      (a, b) =>
        b[1] - a[1]
    )[0][0];
}


/* =========================================
   接頭辞の次番号
========================================= */

function createNextManagementCode(
  prefix
) {

  if (!prefix) {
    return "";
  }


  let maxNumber =
    0;


  toolRecords.forEach(
    tool => {

      const parsed =
        parseManagementCode(
          tool.management_code
        );


      if (!parsed) {
        return;
      }


      if (
        parsed.prefix !==
        prefix
      ) {

        return;
      }


      if (
        parsed.number >
        maxNumber
      ) {

        maxNumber =
          parsed.number;
      }
    }
  );


  const nextNumber =
    maxNumber + 1;


  return (
    `${prefix}-` +
    String(
      nextNumber
    ).padStart(
      3,
      "0"
    )
  );
}


/* =========================================
   旋盤サイズ欄
========================================= */

function createLatheSizeField() {

  if (
    latheSizeLabel
  ) {

    return;
  }


  latheSizeLabel =
    document.createElement(
      "label"
    );


  latheSizeLabel.className =
    "admin-form-label";


  latheSizeLabel.style.display =
    "none";


  const title =
    document.createElement(
      "span"
    );


  title.textContent =
    "旋盤サイズ";


  latheSizeSelect =
    document.createElement(
      "select"
    );


  latheSizeSelect.id =
    "latheSizeSelect";


  latheSizeSelect.className =
    "admin-form-control";


  latheSizeSelect.innerHTML =
    `
      <option value="">
        ---- 選択 ----
      </option>

      <option value="1IN">1IN</option>
      <option value="2IN">2IN</option>
      <option value="3IN">3IN</option>
      <option value="4IN">4IN</option>
    `;


  latheSizeLabel.appendChild(
    title
  );


  latheSizeLabel.appendChild(
    latheSizeSelect
  );


  toolName.parentElement
    .insertAdjacentElement(
      "afterend",
      latheSizeLabel
    );


  latheSizeSelect.addEventListener(
    "change",
    () => {

      if (
        editingToolId.value
      ) {

        return;
      }


      updateAutomaticManagementCode();
    }
  );
}


/* =========================================
   旋盤サイズ表示
========================================= */

function updateLatheSizeField(
  selectedSize = ""
) {

  createLatheSizeField();


  const isLathe =
    getToolNameValue() ===
    "旋盤";


  if (!isLathe) {

    latheSizeLabel.style.display =
      "none";


    latheSizeSelect.value =
      "";


    return;
  }


  latheSizeLabel.style.display =
    "block";


  if (
    selectedSize
  ) {

    latheSizeSelect.value =
      selectedSize;
  }
}


/* =========================================
   管理番号入力状態
========================================= */

function setManagementCodeAutomatic(
  code
) {

  toolManagementCode.value =
    code;


  toolManagementCode.readOnly =
    Boolean(
      code
    );
}


function setManagementCodeManual() {

  toolManagementCode.value =
    "";


  toolManagementCode.readOnly =
    false;
}


/* =========================================
   自動管理番号
========================================= */

function updateAutomaticManagementCode() {

  if (
    editingToolId.value
  ) {

    return;
  }


  const currentToolName =
    getToolNameValue();


  if (
    !currentToolName
  ) {

    setManagementCodeManual();

    return;
  }


  if (
    toolName.value ===
    "__new__"
  ) {

    setManagementCodeManual();

    return;
  }


  if (
    currentToolName ===
    "旋盤"
  ) {

    updateLatheSizeField();


    const size =
      latheSizeSelect
        ? latheSizeSelect.value
        : "";


    if (!size) {

      setManagementCodeManual();

      toolManagementCode.readOnly =
        true;

      toolManagementCode.placeholder =
        "先に旋盤サイズを選択";

      return;
    }


    const prefix =
      `SB-${size}`;


    const code =
      createNextManagementCode(
        prefix
      );


    toolManagementCode.placeholder =
      "";


    setManagementCodeAutomatic(
      code
    );


    return;
  }


  let prefix =
    findExistingPrefix(
      currentToolName
    );


  if (
    !prefix &&
    BATTERY_TOOL_PREFIXES[
      currentToolName
    ]
  ) {

    prefix =
      BATTERY_TOOL_PREFIXES[
        currentToolName
      ];
  }


  if (!prefix) {

    setManagementCodeManual();

    toolManagementCode.placeholder =
      "管理番号を入力";

    return;
  }


  const code =
    createNextManagementCode(
      prefix
    );


  toolManagementCode.placeholder =
    "";


  setManagementCodeAutomatic(
    code
  );
}


/* =========================================
   大分類変更
========================================= */

function handleToolGroupChange() {

  updateToolNameOptions();

  hideNewToolNameInput();

  updateLatheSizeField();


  if (
    !editingToolId.value
  ) {

    setManagementCodeManual();
  }


  if (
    toolGroup.value ===
    "充電工具"
  ) {

    toolOwnershipType.value =
      "personal";


    updateOwnershipFields();


    toolInspectionRequired.value =
      "false";


    toolInspectionCategory.value =
      "";
  }


  updateInspectionFields();
}


/* =========================================
   工具名候補
========================================= */

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
            tool.tool_group ===
              group
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


/* =========================================
   登録用 工具名
========================================= */

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


  if (
    selectedName
  ) {

    toolName.value =
      selectedName;
  }
}


/* =========================================
   検索用 工具名
========================================= */

function updateSearchToolNameOptions() {

  const group =
    toolSearchGroup.value;


  let targetTools =
    toolRecords;


  if (group) {

    targetTools =
      toolRecords.filter(
        tool =>
          tool.tool_group ===
          group
      );
  }


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


      toolSearchName.appendChild(
        option
      );
    }
  );
}


/* =========================================
   新しい工具名
========================================= */

function showNewToolNameInput(
  value = ""
) {

  if (
    !newToolNameInput
  ) {

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


    toolName.parentElement.appendChild(
      newToolNameInput
    );


    newToolNameInput.addEventListener(
      "input",
      () => {

        if (
          !editingToolId.value
        ) {

          setManagementCodeManual();
        }
      }
    );
  }


  newToolNameInput.hidden =
    false;


  newToolNameInput.style.display =
    "block";


  newToolNameInput.value =
    value;


  newToolNameInput.focus();
}


function hideNewToolNameInput() {

  if (
    !newToolNameInput
  ) {

    return;
  }


  newToolNameInput.hidden =
    true;


  newToolNameInput.style.display =
    "none";


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


/* =========================================
   フォーム
========================================= */

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


/* =========================================
   保存データ
========================================= */

function createToolData() {

  const ownership =
    toolOwnershipType.value;


  const isBatteryTool =
    toolGroup.value ===
    "充電工具";


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
      isBatteryTool
        ? false
        : (
            toolInspectionRequired.value ===
            "true"
          ),

    inspection_category:
      isBatteryTool
        ? null
        : (
            toolInspectionCategory.value ||
            null
          ),

    note:
      toolNote.value
        .trim() ||
      null,

    updated_at:
      new Date()
        .toISOString()
  };
}


/* =========================================
   入力確認
========================================= */

function validateTool() {

  if (
    !toolGroup.value
  ) {

    throw new Error(
      "大分類を選択してください"
    );
  }


  if (
    !getToolNameValue()
  ) {

    throw new Error(
      "工具名を入力してください"
    );
  }


  if (
    getToolNameValue() ===
      "旋盤" &&
    !editingToolId.value &&
    (
      !latheSizeSelect ||
      !latheSizeSelect.value
    )
  ) {

    throw new Error(
      "旋盤サイズを選択してください"
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


/* =========================================
   登録・保存
========================================= */

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
    Boolean(
      toolId
    );


  const record =
    createToolData();


  const confirmed =
    window.confirm(
      isEditing
        ? "工具情報を保存しますか？"
        : `管理番号 ${record.management_code} で工具を登録しますか？`
    );


  if (!confirmed) {
    return;
  }


  try {

    let url =
      `${SUPABASE_URL}/rest/v1/tools`;


    let method =
      "POST";


    if (
      isEditing
    ) {

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


    if (
      !response.ok
    ) {

      console.error(
        await response.text()
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
        : `工具を登録しました\n管理番号：${record.management_code}`
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


/* =========================================
   編集
========================================= */

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


  toolManagementCode.readOnly =
    false;


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


    toolInspectionCategory.appendChild(
      option
    );
  }


  toolInspectionCategory.value =
    currentCategory;


  updateInspectionFields();


  if (
    tool.tool_name ===
    "旋盤"
  ) {

    const match =
      String(
        tool.management_code ||
        ""
      ).match(
        /^SB-(1IN|2IN|3IN|4IN)-/
      );


    updateLatheSizeField(
      match
        ? match[1]
        : ""
    );

  } else {

    updateLatheSizeField();
  }


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


/* =========================================
   フォーム初期化
========================================= */

function resetToolForm() {

  editingToolId.value =
    "";


  toolFormTitle.textContent =
    "工具登録";


  toolGroup.value =
    "";


  updateToolNameOptions();


  hideNewToolNameInput();


  updateLatheSizeField();


  toolSpecification.value =
    "";


  toolManagementCode.value =
    "";


  toolManagementCode.readOnly =
    false;


  toolManagementCode.placeholder =
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


  toolInspectionRequired.disabled =
    false;


  toolInspectionRequired.value =
    "false";


  toolInspectionCategory.value =
    "";


  if (
    toolInspectionCategoryLabel
  ) {

    toolInspectionCategoryLabel
      .style.display =
      "block";
  }


  toolNote.value =
    "";


  saveToolButton.textContent =
    "登録する";


  stopToolButton.hidden =
    true;


  disposeToolButton.hidden =
    true;
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


/*
  現在地と状態がズレている既存データにも対応
*/

function getDisplayToolStatus(
  tool
) {

  if (
    tool.status ===
      "repair" ||
    tool.status ===
      "stopped" ||
    tool.status ===
      "disposed"
  ) {

    return tool.status;
  }


  if (
    tool.ownership_type ===
      "shared"
  ) {

    return tool.current_site_id
      ? "in_use"
      : "available";
  }


  return (
    tool.status ||
    "available"
  );
}


/* =========================================
   使用停止
========================================= */

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


/* =========================================
   廃棄
========================================= */

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


  if (
    reason === null
  ) {

    return;
  }


  if (
    !reason.trim()
  ) {

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


  if (
    !response.ok
  ) {

    alert(
      "廃棄にできませんでした"
    );

    return;
  }


  await loadTools();


  closeToolForm();
}


/* =========================================
   社員読込
========================================= */

async function loadEmployees() {

  const response =
    await portalFetch(
      `${SUPABASE_URL}/rest/v1/employees?select=*&order=id.asc`
    );


  if (
    !response.ok
  ) {

    throw new Error(
      "社員情報を読み込めませんでした"
    );
  }


  employeeRecords =
    await response.json();


  populateEmployeeOptions();
}


/* =========================================
   現場読込
========================================= */

async function loadSites() {

  const response =
    await portalFetch(
      `${SUPABASE_URL}/rest/v1/sites?select=*&order=id.asc`
    );


  if (
    !response.ok
  ) {

    throw new Error(
      "現場情報を読み込めませんでした"
    );
  }


  siteRecords =
    await response.json();
}


/* =========================================
   工具読込
========================================= */

async function loadTools() {

  const response =
    await portalFetch(
      `${SUPABASE_URL}/rest/v1/tools?select=*&order=tool_name.asc,management_code.asc`
    );


  if (
    !response.ok
  ) {

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


/* =========================================
   工具一覧
========================================= */

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
          tool.tool_group !== groupFilter
        ) {
          return false;
        }

        if (
          nameFilter &&
          tool.tool_name !== nameFilter
        ) {
          return false;
        }

        if (
          ownershipFilter &&
          tool.ownership_type !== ownershipFilter
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
              tool.performance,
              employeeName,
              tool.owner_company_name,
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


  toolSearchResultTitle.textContent =
    `検索結果（${filteredTools.length}件)`;


  toolMasterList.innerHTML =
    "";


  if (
    filteredTools.length === 0
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


      const locationText =
        tool.current_site_id
          ? "現場"
          : "倉庫";


      const displayStatus =
        formatToolStatus(
          getDisplayToolStatus(
            tool
          )
        );


      /* 1工具ごとの区切り */

      card.style.padding =
        "12px 0";

      card.style.borderBottom =
        "1px solid #d9e2ef";

      card.style.cursor =
        "pointer";


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


      /* 現在地 ＋ 状態 */

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
        displayStatus;


      bottom.appendChild(
        location
      );

      bottom.appendChild(
        status
      );


      card.appendChild(
        code
      );

      card.appendChild(
        name
      );

      card.appendChild(
        bottom
      );


      card.addEventListener(
        "click",
        () => {

          startToolEdit(
            tool
          );
        }
      );


      toolMasterList.appendChild(
        card
      );
    }
  );
}


/* =========================================
   イベント
========================================= */

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
    handleToolGroupChange
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


      updateLatheSizeField();


      updateAutomaticManagementCode();
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


/* =========================================
   初期処理
========================================= */

async function initializeToolMaster() {

  try {

    createLatheSizeField();


    updateOwnershipFields();


    updateToolNameOptions();


    updateInspectionFields();


    await Promise.all([
      loadEmployees(),
      loadSites()
    ]);


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