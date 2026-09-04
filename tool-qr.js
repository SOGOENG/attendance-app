const SUPABASE_URL =
  "https://fgmvmbjnoyagnpygcbky.supabase.co";


/* =========================================
   HTML
========================================= */

const toolQrGroup =
  document.getElementById("toolQrGroup");

const toolQrName =
  document.getElementById("toolQrName");

const toolQrOwnership =
  document.getElementById("toolQrOwnership");

const toolQrEmployeeLabel =
  document.getElementById("toolQrEmployeeLabel");

const toolQrEmployee =
  document.getElementById("toolQrEmployee");

const toolQrContractorLabel =
  document.getElementById("toolQrContractorLabel");

const toolQrContractor =
  document.getElementById("toolQrContractor");

const toolQrSearch =
  document.getElementById("toolQrSearch");

const toolQrSearchButton =
  document.getElementById("toolQrSearchButton");

const toolQrResultSection =
  document.getElementById("toolQrResultSection");

const toolQrResultTitle =
  document.getElementById("toolQrResultTitle");

const toolQrResultClose =
  document.getElementById("toolQrResultClose");

const toolQrMessage =
  document.getElementById("toolQrMessage");

const toolQrList =
  document.getElementById("toolQrList");

const toolQrSelectAll =
  document.getElementById("toolQrSelectAll");

const toolQrStickerAll =
  document.getElementById("toolQrStickerAll");

const toolQrCreateButton =
  document.getElementById("toolQrCreateButton");

const toolQrOutputSection =
  document.getElementById("toolQrOutputSection");

const toolQrOutputClose =
  document.getElementById("toolQrOutputClose");

const toolQrOutputMessage =
  document.getElementById("toolQrOutputMessage");

const toolQrOutputList =
  document.getElementById("toolQrOutputList");

const toolQrPrintButton =
  document.getElementById("toolQrPrintButton");


/* =========================================
   データ
========================================= */

let toolRecords = [];

let employeeRecords = [];

let inspectionRecords = [];


const latestStickerMap =
  new Map();


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


function getOwnershipText(
  ownership
) {

  switch (ownership) {

    case "personal":
      return "個人";

    case "contractor":
      return "協力業者";

    case "shared":
      return "共有";

    default:
      return "-";
  }
}


/* =========================================
   社員
========================================= */

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
}


/* =========================================
   工具
========================================= */

async function loadTools() {

  const response =
    await portalFetch(
      `${SUPABASE_URL}/rest/v1/tools` +
      `?select=*` +
      `&status=neq.disposed` +
      `&order=tool_group.asc,tool_name.asc,management_code.asc`
    );


  if (!response.ok) {

    throw new Error(
      "工具情報を読み込めませんでした"
    );
  }


  toolRecords =
    await response.json();
}


/* =========================================
   点検シール
========================================= */

async function loadInspectionStickers() {

  const response =
    await portalFetch(
      `${SUPABASE_URL}/rest/v1/tool_inspections` +
      `?select=id,tool_id,sticker_number,inspection_date` +
      `&order=id.desc`
    );


  if (!response.ok) {

    console.error(
      await response.text()
    );


    throw new Error(
      "点検シール情報を読み込めませんでした"
    );
  }


  inspectionRecords =
    await response.json();


  latestStickerMap.clear();


  inspectionRecords.forEach(
    record => {

      const toolId =
        String(
          record.tool_id
        );


      const sticker =
        record.sticker_number;


      if (
        sticker === null ||
        sticker === undefined ||
        String(sticker).trim() === ""
      ) {

        return;
      }


      if (
        !latestStickerMap.has(
          toolId
        )
      ) {

        latestStickerMap.set(
          toolId,
          String(sticker)
        );
      }
    }
  );
}


/* =========================================
   大分類
========================================= */

function buildGroupOptions() {

  toolQrGroup.innerHTML =
    `<option value="">すべて</option>`;


  const groups =
    [
      ...new Set(
        toolRecords
          .map(
            tool =>
              tool.tool_group
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


  groups.forEach(
    group => {

      const option =
        document.createElement(
          "option"
        );


      option.value =
        group;

      option.textContent =
        group;


      toolQrGroup.appendChild(
        option
      );
    }
  );
}


/* =========================================
   工具名
========================================= */

function updateToolNameOptions() {

  const group =
    toolQrGroup.value;


  toolQrName.innerHTML =
    `<option value="">すべて</option>`;


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


  const names =
    [
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


      toolQrName.appendChild(
        option
      );
    }
  );
}


/* =========================================
   社員
========================================= */

function buildEmployeeOptions() {

  toolQrEmployee.innerHTML =
    `<option value="">すべて</option>`;


  const ids =
    new Set(
      toolRecords
        .filter(
          tool =>
            tool.ownership_type ===
            "personal"
        )
        .map(
          tool =>
            String(
              tool.assigned_employee_id ||
              ""
            )
        )
        .filter(Boolean)
    );


  employeeRecords
    .filter(
      employee =>
        ids.has(
          String(employee.id)
        )
    )
    .forEach(
      employee => {

        const option =
          document.createElement(
            "option"
          );


        option.value =
          employee.id;


        option.textContent =
          employee.name ||
          employee.employee_name ||
          employee.full_name ||
          "";


        toolQrEmployee.appendChild(
          option
        );
      }
    );
}


/* =========================================
   協力業者
========================================= */

function buildContractorOptions() {

  toolQrContractor.innerHTML =
    `<option value="">すべて</option>`;


  const contractors =
    [
      ...new Set(
        toolRecords
          .filter(
            tool =>
              tool.ownership_type ===
              "contractor"
          )
          .map(
            tool =>
              tool.owner_company_name
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


  contractors.forEach(
    contractor => {

      const option =
        document.createElement(
          "option"
        );


      option.value =
        contractor;

      option.textContent =
        contractor;


      toolQrContractor.appendChild(
        option
      );
    }
  );
}


/* =========================================
   所有区分
========================================= */

function updateOwnershipFields() {

  const ownership =
    toolQrOwnership.value;


  toolQrEmployee.value =
    "";

  toolQrContractor.value =
    "";


  toolQrEmployeeLabel.hidden =
    ownership !==
    "personal";


  toolQrContractorLabel.hidden =
    ownership !==
    "contractor";
}


/* =========================================
   検索
========================================= */

function searchTools() {

  const group =
    toolQrGroup.value;


  const name =
    toolQrName.value;


  const ownership =
    toolQrOwnership.value;


  const employeeId =
    toolQrEmployee.value;


  const contractor =
    toolQrContractor.value;


  const keyword =
    toolQrSearch.value
      .trim()
      .toLowerCase();


  const filtered =
    toolRecords.filter(
      tool => {

        if (
          group &&
          tool.tool_group !==
          group
        ) {
          return false;
        }


        if (
          name &&
          tool.tool_name !==
          name
        ) {
          return false;
        }


        if (
          ownership &&
          tool.ownership_type !==
          ownership
        ) {
          return false;
        }


        if (
          employeeId &&
          String(
            tool.assigned_employee_id
          ) !==
          String(employeeId)
        ) {
          return false;
        }


        if (
          contractor &&
          tool.owner_company_name !==
          contractor
        ) {
          return false;
        }


        if (keyword) {

          const target =
            [
              tool.management_code,
              tool.tool_name,
              tool.tool_group,
              tool.specification,
              tool.manufacturer,
              tool.model_number,
              tool.serial_number,
              getEmployeeName(
                tool.assigned_employee_id
              ),
              tool.owner_company_name
            ]
              .filter(Boolean)
              .join(" ")
              .toLowerCase();


          if (
            !target.includes(
              keyword
            )
          ) {

            return false;
          }
        }


        return true;
      }
    );


  displayTools(
    filtered
  );
}


/* =========================================
   検索結果
========================================= */

function displayTools(
  tools
) {

  toolQrResultSection
    .classList
    .remove(
      "hidden"
    );


  toolQrOutputSection
    .classList
    .add(
      "hidden"
    );


  toolQrResultTitle.textContent =
    `検索結果（${tools.length}件）`;


  toolQrMessage.textContent =
    "QRコードを発行する工具にチェックしてください";


  toolQrList.innerHTML =
    "";


  toolQrSelectAll.checked =
    false;

  toolQrSelectAll.indeterminate =
    false;


  toolQrStickerAll.checked =
    false;

  toolQrStickerAll.indeterminate =
    false;


  tools.forEach(
    tool => {

      const card =
        document.createElement(
          "article"
        );


      card.className =
        "tool-qr-item";


      const stickerNumber =
        latestStickerMap.get(
          String(tool.id)
        );


      let ownerText =
        "";


      if (
        tool.ownership_type ===
        "personal"
      ) {

        ownerText =
          getEmployeeName(
            tool.assigned_employee_id
          );
      }


      if (
        tool.ownership_type ===
        "contractor"
      ) {

        ownerText =
          tool.owner_company_name ||
          "";
      }


      card.innerHTML =
        `
          <div class="tool-qr-item-main">

            <input
              type="checkbox"
              class="tool-qr-checkbox"
              data-tool-id="${escapeHtml(
                tool.id
              )}"
            >

            <div class="tool-qr-item-content">

              <div class="tool-qr-code-label">
                ${escapeHtml(
                  tool.management_code ||
                  "-"
                )}
              </div>


              <div class="tool-qr-tool-name">
                ${escapeHtml(
                  tool.tool_name ||
                  "-"
                )}
              </div>


              <div class="tool-qr-owner">

                ${escapeHtml(
                  getOwnershipText(
                    tool.ownership_type
                  )
                )}

                ${
                  ownerText
                    ? `　${escapeHtml(
                        ownerText
                      )}`
                    : ""
                }

              </div>


              ${
                stickerNumber
                  ? `
                    <label class="tool-qr-sticker-option">

                      <input
                        type="checkbox"
                        class="tool-qr-sticker-checkbox"
                        data-tool-id="${escapeHtml(
                          tool.id
                        )}"
                      >

                      点検シールNo.${escapeHtml(
                        stickerNumber
                      )}を印字

                    </label>
                  `
                  : ""
              }

            </div>

          </div>
        `;


      toolQrList.appendChild(
        card
      );
    }
  );


  document
    .querySelectorAll(
      ".tool-qr-checkbox"
    )
    .forEach(
      checkbox => {

        checkbox.addEventListener(
          "change",
          updateToolSelectAllState
        );
      }
    );


  document
    .querySelectorAll(
      ".tool-qr-sticker-checkbox"
    )
    .forEach(
      checkbox => {

        checkbox.addEventListener(
          "change",
          updateStickerSelectAllState
        );
      }
    );


  updateStickerSelectAllState();


  toolQrResultSection
    .scrollIntoView({
      behavior:
        "smooth",

      block:
        "start"
    });
}


/* =========================================
   全工具
========================================= */

function selectAllTools() {

  const checked =
    toolQrSelectAll.checked;


  document
    .querySelectorAll(
      ".tool-qr-checkbox"
    )
    .forEach(
      checkbox => {

        checkbox.checked =
          checked;
      }
    );


  toolQrSelectAll.indeterminate =
    false;
}


function updateToolSelectAllState() {

  const list =
    [
      ...document.querySelectorAll(
        ".tool-qr-checkbox"
      )
    ];


  const checked =
    list.filter(
      item =>
        item.checked
    ).length;


  toolQrSelectAll.checked =
    list.length > 0 &&
    checked ===
      list.length;


  toolQrSelectAll.indeterminate =
    checked > 0 &&
    checked <
      list.length;
}


/* =========================================
   全点検シール
========================================= */

function selectAllStickers() {

  const checked =
    toolQrStickerAll.checked;


  document
    .querySelectorAll(
      ".tool-qr-sticker-checkbox"
    )
    .forEach(
      checkbox => {

        checkbox.checked =
          checked;
      }
    );


  toolQrStickerAll.indeterminate =
    false;
}


function updateStickerSelectAllState() {

  const list =
    [
      ...document.querySelectorAll(
        ".tool-qr-sticker-checkbox"
      )
    ];


  if (
    list.length ===
    0
  ) {

    toolQrStickerAll.checked =
      false;

    toolQrStickerAll.indeterminate =
      false;

    toolQrStickerAll.disabled =
      true;

    return;
  }


  toolQrStickerAll.disabled =
    false;


  const checked =
    list.filter(
      item =>
        item.checked
    ).length;


  toolQrStickerAll.checked =
    checked ===
    list.length;


  toolQrStickerAll.indeterminate =
    checked > 0 &&
    checked <
      list.length;
}


/* =========================================
   選択工具
========================================= */

function getSelectedItems() {

  const selected =
    [
      ...document.querySelectorAll(
        ".tool-qr-checkbox:checked"
      )
    ];


  return selected
    .map(
      checkbox => {

        const toolId =
          String(
            checkbox.dataset.toolId
          );


        const tool =
          toolRecords.find(
            item =>
              String(item.id) ===
              toolId
          );


        if (!tool) {
          return null;
        }


        const stickerCheckbox =
          document.querySelector(
            `.tool-qr-sticker-checkbox[data-tool-id="${toolId}"]`
          );


        return {

          tool,

          printSticker:
            Boolean(
              stickerCheckbox &&
              stickerCheckbox.checked
            ),

          stickerNumber:
            latestStickerMap.get(
              toolId
            )
        };
      }
    )
    .filter(Boolean);
}


/* =========================================
   QRリンク
========================================= */

function createToolDetailUrl(
  toolId
) {

  const url =
    new URL(
      "tool-detail.html",
      window.location.href
    );


  url.searchParams.set(
    "id",
    toolId
  );


  return url.href;
}


/* =========================================
   QRラベル1枚作成
========================================= */

function createQrLabel(
  item
) {

  const printItem =
    document.createElement(
      "div"
    );


  printItem.className =
    "tool-qr-print-item";


  if (
    !item.printSticker ||
    !item.stickerNumber
  ) {

    printItem.classList.add(
      "no-sticker-tab"
    );
  }


  const body =
    document.createElement(
      "div"
    );


  body.className =
    "tool-qr-label-body";


  const qrArea =
    document.createElement(
      "div"
    );


  qrArea.className =
    "tool-qr-code-area";


  const code =
    document.createElement(
      "div"
    );


  code.className =
    "tool-qr-output-code";


  code.textContent =
    item.tool.management_code ||
    "-";


  const name =
    document.createElement(
      "div"
    );


  name.className =
    "tool-qr-output-name";


  name.textContent =
    item.tool.tool_name ||
    "-";


  body.appendChild(
    qrArea
  );


  body.appendChild(
    code
  );


  body.appendChild(
    name
  );


  printItem.appendChild(
    body
  );


  if (
    item.printSticker &&
    item.stickerNumber
  ) {

    const tab =
      document.createElement(
        "div"
      );


    tab.className =
      "tool-qr-sticker-tab";


    const tabText =
      document.createElement(
        "div"
      );


    tabText.className =
      "tool-qr-sticker-tab-text";


    tabText.textContent =
      `No.${item.stickerNumber}`;


    tab.appendChild(
      tabText
    );


    printItem.appendChild(
      tab
    );
  }


  new QRCode(
    qrArea,
    {

      text:
        createToolDetailUrl(
          item.tool.id
        ),

      width:
        120,

      height:
        120,

      correctLevel:
        QRCode.CorrectLevel.M
    }
  );


  return printItem;
}


/* =========================================
   QR表示
   35枚ごとにページ作成
========================================= */

function createQrOutput() {

  const items =
    getSelectedItems();


  if (
    items.length ===
    0
  ) {

    alert(
      "QRコードを発行する工具を選択してください"
    );

    return;
  }


  if (
    typeof QRCode ===
    "undefined"
  ) {

    alert(
      "QRコード機能を読み込めませんでした"
    );

    return;
  }


  toolQrOutputList.innerHTML =
    "";


  toolQrOutputMessage.textContent =
    `${items.length}件のQRコードを表示しています`;


  let currentPage =
    null;


  items.forEach(
    (item, index) => {

      /*
        35件ごとに新ページ
      */

      if (
        index %
        35 ===
        0
      ) {

        currentPage =
          document.createElement(
            "div"
          );


        currentPage.className =
          "tool-qr-print-page";


        toolQrOutputList.appendChild(
          currentPage
        );
      }


      const label =
        createQrLabel(
          item
        );


      currentPage.appendChild(
        label
      );
    }
  );


  toolQrOutputSection
    .classList
    .remove(
      "hidden"
    );


  toolQrOutputSection
    .scrollIntoView({
      behavior:
        "smooth",

      block:
        "start"
    });
}


/* =========================================
   PDF保存
========================================= */

function savePdf() {

  const items =
    document.querySelectorAll(
      ".tool-qr-print-item"
    );


  if (
    items.length ===
    0
  ) {

    alert(
      "PDFに出力するQRコードがありません"
    );

    return;
  }


  window.print();
}


/* =========================================
   イベント
========================================= */

toolQrGroup.addEventListener(
  "change",
  updateToolNameOptions
);


toolQrOwnership.addEventListener(
  "change",
  updateOwnershipFields
);


toolQrSearchButton.addEventListener(
  "click",
  searchTools
);


toolQrSearch.addEventListener(
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


toolQrSelectAll.addEventListener(
  "change",
  selectAllTools
);


toolQrStickerAll.addEventListener(
  "change",
  selectAllStickers
);


toolQrCreateButton.addEventListener(
  "click",
  createQrOutput
);


toolQrPrintButton.addEventListener(
  "click",
  savePdf
);


toolQrResultClose.addEventListener(
  "click",
  () => {

    toolQrResultSection
      .classList
      .add(
        "hidden"
      );
  }
);


toolQrOutputClose.addEventListener(
  "click",
  () => {

    toolQrOutputSection
      .classList
      .add(
        "hidden"
      );
  }
);


/* =========================================
   初期化
========================================= */

async function initializeToolQr() {

  try {

    await loadEmployees();

    await loadTools();

    await loadInspectionStickers();


    buildGroupOptions();

    updateToolNameOptions();

    buildEmployeeOptions();

    buildContractorOptions();

    updateOwnershipFields();


  } catch (error) {

    console.error(
      error
    );


    toolQrMessage.textContent =
      error.message;
  }
}


initializeToolQr();
