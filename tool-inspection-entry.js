const SUPABASE_URL =
  "https://fgmvmbjnoyagnpygcbky.supabase.co";


/* =========================================
   HTML要素
========================================= */

const inspectionEntryBackLink =
  document.getElementById("inspectionEntryBackLink");

const inspectionEntryToolName =
  document.getElementById("inspectionEntryToolName");

const inspectionEntryToolGroup =
  document.getElementById("inspectionEntryToolGroup");

const inspectionEntryManagementCode =
  document.getElementById("inspectionEntryManagementCode");

const inspectionEntrySpecification =
  document.getElementById("inspectionEntrySpecification");

const inspectionEntryManufacturer =
  document.getElementById("inspectionEntryManufacturer");

const inspectionEntryModelNumber =
  document.getElementById("inspectionEntryModelNumber");

const inspectionEntrySerialNumber =
  document.getElementById("inspectionEntrySerialNumber");

const inspectionEntryCategory =
  document.getElementById("inspectionEntryCategory");

const inspectionDate =
  document.getElementById("inspectionDate");

const inspectionStickerNumber =
  document.getElementById("inspectionStickerNumber");

const inspectionChecklistGuide =
  document.getElementById("inspectionChecklistGuide");

const inspectionChecklist =
  document.getElementById("inspectionChecklist");

const inspectionStickerGuide =
  document.getElementById("inspectionStickerGuide");

const inspectionStickerConfirmed =
  document.getElementById("inspectionStickerConfirmed");

const inspectionResult =
  document.getElementById("inspectionResult");

const inspectionDefectDetail =
  document.getElementById("inspectionDefectDetail");

const inspectionCorrectiveAction =
  document.getElementById("inspectionCorrectiveAction");

const inspectionNote =
  document.getElementById("inspectionNote");

const saveInspectionButton =
  document.getElementById("saveInspectionButton");

const inspectionEntryMessage =
  document.getElementById("inspectionEntryMessage");


let currentCycle = null;
let currentTool = null;


/* =========================================
   Excel正式点検項目
========================================= */

const INSPECTION_ITEMS = {

  1:
    "１００Ｖ用電気機器・工具は３極プラグ・３極コンセントを使用しているか。",

  2:
    "ケーブル接続用コネクターに破損はないか。",

  3:
    "アース線は切断していないか。",

  4:
    "絶縁抵抗は１ＭΩ以上あるか。",

  5:
    "キャブタイヤケーブルの被覆に破損はないか。（溶接用を含む）",

  6:
    "機器本体に外観的損傷・危険な露出部はないか。保護装置の作動はよいか。",

  7:
    "端子部の接続は完全か。",

  8:
    "取付部のゆるみ・はずれ・損傷はないか。",

  9:
    "差込部には社名表示札は付いているか。",

  10:
    "正常に働く漏電遮断器がついているか。",

  11:
    "正常に働く自動電撃防止装置がついているか。",

  12:
    "溶接ホルダー絶縁防護部分に損傷はないか。"
};


const CIRCLE_NUMBERS = {
  1: "①",
  2: "②",
  3: "③",
  4: "④",
  5: "⑤",
  6: "⑥",
  7: "⑦",
  8: "⑧",
  9: "⑨",
  10: "⑩",
  11: "⑪",
  12: "⑫"
};


/* =========================================
   Excel区分別対象項目
========================================= */

const CATEGORY_CONFIG = {

  "3p": {
    name: "3P工具",

    items: [
      { number: 1, mark: "○" },
      { number: 2, mark: "○" },
      { number: 3, mark: "○" },
      { number: 4, mark: "○" },
      { number: 5, mark: "○" },
      { number: 6, mark: "○" },
      { number: 7, mark: "○" },
      { number: 8, mark: "○" }
    ],

    sticker: "required"
  },


  "double_insulated": {
    name: "二重絶縁工具",

    items: [
      { number: 2, mark: "○" },
      { number: 5, mark: "○" },
      { number: 6, mark: "○" },
      { number: 7, mark: "○" },
      { number: 8, mark: "○" }
    ],

    sticker: "required"
  },


  "battery": {
    name: "充電式工具",

    items: [
      { number: 2, mark: "○" },
      { number: 5, mark: "○" },
      { number: 6, mark: "○" },
      { number: 7, mark: "○" },
      { number: 8, mark: "○" }
    ],

    sticker: "optional"
  },


  "cord_reel": {
    name: "コードリール",

    items: [
      { number: 1, mark: "○" },
      { number: 2, mark: "○" },
      { number: 3, mark: "○" },
      { number: 4, mark: "○" },
      { number: 5, mark: "○" },
      { number: 6, mark: "○" },
      { number: 7, mark: "○" },
      { number: 8, mark: "○" },
      { number: 9, mark: "○" },
      { number: 10, mark: "○" }
    ],

    sticker: "required"
  },


  "ac_welder": {
    name: "交流式溶接機",

    items: [
      { number: 2, mark: "○" },
      { number: 3, mark: "○" },
      { number: 4, mark: "○" },
      { number: 5, mark: "○" },
      { number: 6, mark: "○" },
      { number: 7, mark: "○" },
      { number: 8, mark: "○" },
      { number: 11, mark: "○" },
      { number: 12, mark: "○" }
    ],

    sticker: "required"
  },


  "dc_welder": {
    name: "直流式溶接機",

    items: [
      { number: 5, mark: "○" },
      { number: 6, mark: "○" },
      { number: 7, mark: "○" },
      { number: 8, mark: "○" },
      { number: 11, mark: "▲" },
      { number: 12, mark: "○" }
    ],

    sticker: "required"
  }
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


function getParams() {
  const params =
    new URLSearchParams(
      window.location.search
    );

  return {
    cycleId:
      params.get("cycle"),

    toolId:
      params.get("tool")
  };
}


function getLoginUser() {
  const savedUser =
    localStorage.getItem(
      "portalLoginUser"
    );

  if (!savedUser) {
    return null;
  }

  try {
    return JSON.parse(savedUser);

  } catch (error) {
    console.error(error);

    return null;
  }
}


function setToday() {
  const today =
    new Date();

  const year =
    today.getFullYear();

  const month =
    String(
      today.getMonth() + 1
    ).padStart(2, "0");

  const day =
    String(
      today.getDate()
    ).padStart(2, "0");

  inspectionDate.value =
    `${year}-${month}-${day}`;
}


/* =========================================
   サイクル
========================================= */

async function loadCycle() {
  const { cycleId } =
    getParams();

  if (!cycleId) {
    throw new Error(
      "点検サイクルIDがありません"
    );
  }

  const url =
    `${SUPABASE_URL}/rest/v1/tool_inspection_cycles` +
    `?id=eq.${cycleId}` +
    `&select=*`;

  const response =
    await portalFetch(url);

  if (!response.ok) {
    throw new Error(
      "点検サイクルを読み込めませんでした"
    );
  }

  const records =
    await response.json();

  if (records.length === 0) {
    throw new Error(
      "点検サイクルが見つかりません"
    );
  }

  currentCycle =
    records[0];

  inspectionStickerNumber.value =
    currentCycle.next_sticker_number ??
    "";

  inspectionEntryBackLink.href =
    `tool-inspection-list.html?cycle=${currentCycle.id}`;
}


/* =========================================
   工具
========================================= */

async function loadTool() {
  const { toolId } =
    getParams();

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

  const records =
    await response.json();

  if (records.length === 0) {
    throw new Error(
      "工具が見つかりません"
    );
  }

  currentTool =
    records[0];
}


function displayTool() {
  inspectionEntryToolName.textContent =
    `${currentTool.tool_name}` +
    `${
      currentTool.specification
        ? ` ${currentTool.specification}`
        : ""
    }`;

  inspectionEntryToolGroup.textContent =
    currentTool.tool_group ||
    "その他";

  inspectionEntryManagementCode.textContent =
    currentTool.management_code ||
    "-";

  inspectionEntrySpecification.textContent =
    currentTool.specification ||
    "-";

  inspectionEntryManufacturer.textContent =
    currentTool.manufacturer ||
    "-";

  inspectionEntryModelNumber.textContent =
    currentTool.model_number ||
    "-";

  inspectionEntrySerialNumber.textContent =
    currentTool.serial_number ||
    "-";

  const config =
    CATEGORY_CONFIG[
      currentTool.inspection_category
    ];

  inspectionEntryCategory.textContent =
    config
      ? config.name
      : "未設定";
}


/* =========================================
   点検項目
========================================= */

function displayChecklist() {
  inspectionChecklist.innerHTML =
    "";

  const config =
    CATEGORY_CONFIG[
      currentTool.inspection_category
    ];

  if (!config) {
    inspectionChecklistGuide.textContent =
      "";

    inspectionChecklist.innerHTML =
      `
        <p class="schedule-empty-message">
          点検区分が設定されていません
        </p>
      `;

    return;
  }

  inspectionChecklistGuide.textContent =
    `${config.name}の対象項目`;

  config.items.forEach(item => {

    const label =
      document.createElement(
        "label"
      );

    label.className =
      "inspection-check-row";

    const mark =
      item.mark === "▲"
        ? "【▲】"
        : "";

    label.innerHTML =
      `
        <input
          type="checkbox"
          class="inspection-check-item"
          data-item-number="${item.number}"
          data-item-mark="${item.mark}"
        >

        <span>
          <strong>
            ${CIRCLE_NUMBERS[item.number]}
            ${mark}
          </strong>

          ${escapeHtml(
            INSPECTION_ITEMS[item.number]
          )}
        </span>
      `;

    inspectionChecklist.appendChild(
      label
    );
  });


  if (
    config.sticker ===
    "optional"
  ) {
    inspectionStickerGuide.textContent =
      "原則、点検済みシールの貼り付けは不要です。充電器への貼り付けは任意です。";

  } else {
    inspectionStickerGuide.textContent =
      "点検済みシールの貼り付けが必要です。";
  }
}


/* =========================================
   チェック結果
========================================= */

function getChecklistResults() {
  const results = {};

  document
    .querySelectorAll(
      ".inspection-check-item"
    )
    .forEach(checkbox => {

      results[
        checkbox.dataset.itemNumber
      ] = {
        checked:
          checkbox.checked,

        mark:
          checkbox.dataset.itemMark
      };
    });

  return results;
}


/* =========================================
   入力確認
========================================= */

function validateInspection() {
  if (!inspectionDate.value) {
    throw new Error(
      "点検日を入力してください"
    );
  }

  if (
    !inspectionStickerNumber.value
  ) {
    throw new Error(
      "シール番号を入力してください"
    );
  }

  if (!inspectionResult.value) {
    throw new Error(
      "判定を選択してください"
    );
  }

  const config =
    CATEGORY_CONFIG[
      currentTool.inspection_category
    ];

  const checkboxes =
    [
      ...document.querySelectorAll(
        ".inspection-check-item"
      )
    ];

  const uncheckedRequired =
    checkboxes.filter(
      checkbox =>
        checkbox.dataset.itemMark === "○" &&
        !checkbox.checked
    );

  if (
    inspectionResult.value === "ok" &&
    uncheckedRequired.length > 0
  ) {
    throw new Error(
      "OK判定の場合は対象の点検項目をすべて確認してください"
    );
  }

  if (
    config?.sticker === "required" &&
    !inspectionStickerConfirmed.checked
  ) {
    throw new Error(
      "点検済みシールを確認してください"
    );
  }

  if (
    inspectionResult.value === "ng" &&
    !inspectionDefectDetail.value.trim()
  ) {
    throw new Error(
      "NGの場合は不良内容を入力してください"
    );
  }
}


/* =========================================
   保存
========================================= */

async function saveInspection() {
  inspectionEntryMessage.textContent =
    "";

  try {
    validateInspection();

  } catch (error) {
    inspectionEntryMessage.textContent =
      error.message;

    return;
  }

  const confirmed =
    window.confirm(
      `${currentTool.tool_name}` +
      `${
        currentTool.specification
          ? ` ${currentTool.specification}`
          : ""
      }\n\n` +
      `判定：${
        inspectionResult.value === "ok"
          ? "OK"
          : "NG"
      }\n` +
      `シール番号：${inspectionStickerNumber.value}\n\n` +
      "この内容で保存しますか？"
    );

  if (!confirmed) {
    return;
  }

  saveInspectionButton.disabled =
    true;

  saveInspectionButton.textContent =
    "保存中...";

  try {
    const loginUser =
      getLoginUser();

    const checklistResults =
      getChecklistResults();

    const inspectionUrl =
      `${SUPABASE_URL}/rest/v1/tool_inspections`;

    const inspectionResponse =
      await portalFetch(
        inspectionUrl,
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

              inspection_cycle:
                currentCycle.cycle_code,

              inspection_date:
                inspectionDate.value,

              sticker_number:
                String(
                  inspectionStickerNumber.value
                ),

              inspector_employee_id:
                loginUser
                  ? loginUser.id
                  : null,

              result:
                inspectionResult.value,

              defect_detail:
                inspectionDefectDetail.value
                  .trim() || null,

              corrective_action:
                inspectionCorrectiveAction.value
                  .trim() || null,

              note:
                inspectionNote.value
                  .trim() || null,

              checklist_results:
                checklistResults,

              sticker_confirmed:
                inspectionStickerConfirmed.checked
            })
        }
      );

    if (!inspectionResponse.ok) {
      console.error(
        await inspectionResponse.text()
      );

      throw new Error(
        "点検結果を保存できませんでした"
      );
    }


    const currentSticker =
      Number(
        inspectionStickerNumber.value
      );

    const cycleUrl =
      `${SUPABASE_URL}/rest/v1/tool_inspection_cycles` +
      `?id=eq.${currentCycle.id}`;

    const cycleResponse =
      await portalFetch(
        cycleUrl,
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
              next_sticker_number:
                currentSticker + 1,

              updated_at:
                new Date()
                  .toISOString()
            })
        }
      );

    if (!cycleResponse.ok) {
      console.error(
        await cycleResponse.text()
      );

      throw new Error(
        "次回シール番号を更新できませんでした"
      );
    }

    alert(
      "点検結果を保存しました"
    );

    window.location.href =
      `tool-inspection-list.html?cycle=${currentCycle.id}`;

  } catch (error) {
    console.error(error);

    inspectionEntryMessage.textContent =
      error.message;

  } finally {
    saveInspectionButton.disabled =
      false;

    saveInspectionButton.textContent =
      "点検結果を保存";
  }
}


/* =========================================
   イベント
========================================= */

saveInspectionButton.addEventListener(
  "click",
  saveInspection
);


/* =========================================
   初期化
========================================= */

async function initialize() {
  inspectionEntryMessage.textContent =
    "";

  try {
    setToday();

    await Promise.all([
      loadCycle(),
      loadTool()
    ]);

    displayTool();

    displayChecklist();

  } catch (error) {
    console.error(error);

    inspectionEntryMessage.textContent =
      error.message;
  }
}


initialize();