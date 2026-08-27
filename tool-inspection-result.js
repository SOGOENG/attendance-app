/* =========================================
   Supabase
========================================= */

const SUPABASE_URL =
  "https://fgmvmbjnoyagnpygcbky.supabase.co";


/* =========================================
   HTML要素
========================================= */

const inspectionResultBackLink =
  document.getElementById(
    "inspectionResultBackLink"
  );

const resultToolName =
  document.getElementById(
    "resultToolName"
  );

const resultToolGroup =
  document.getElementById(
    "resultToolGroup"
  );

const resultManagementCode =
  document.getElementById(
    "resultManagementCode"
  );

const resultSpecification =
  document.getElementById(
    "resultSpecification"
  );

const resultManufacturer =
  document.getElementById(
    "resultManufacturer"
  );

const resultModelNumber =
  document.getElementById(
    "resultModelNumber"
  );

const resultSerialNumber =
  document.getElementById(
    "resultSerialNumber"
  );

const resultInspectionCategory =
  document.getElementById(
    "resultInspectionCategory"
  );

const resultInspectionDate =
  document.getElementById(
    "resultInspectionDate"
  );

const resultInspector =
  document.getElementById(
    "resultInspector"
  );

const resultStickerNumber =
  document.getElementById(
    "resultStickerNumber"
  );

const resultJudgement =
  document.getElementById(
    "resultJudgement"
  );

const resultStickerConfirmed =
  document.getElementById(
    "resultStickerConfirmed"
  );

const resultChecklist =
  document.getElementById(
    "resultChecklist"
  );

const resultDefectDetail =
  document.getElementById(
    "resultDefectDetail"
  );

const resultCorrectiveAction =
  document.getElementById(
    "resultCorrectiveAction"
  );

const resultNote =
  document.getElementById(
    "resultNote"
  );

const inspectionResultMessage =
  document.getElementById(
    "inspectionResultMessage"
  );


/* =========================================
   データ
========================================= */

let currentCycle = null;
let currentTool = null;
let currentInspection = null;

const employeeNameMap =
  new Map();


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
   点検区分
========================================= */

function formatInspectionCategory(
  category
) {
  switch (category) {

    case "3p":
      return "3P工具";

    case "double_insulated":
      return "二重絶縁工具";

    case "battery":
      return "充電式工具";

    case "cord_reel":
      return "コードリール";

    case "ac_welder":
      return "交流式溶接機";

    case "dc_welder":
      return "直流式溶接機";

    default:
      return "-";
  }
}


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


/* =========================================
   社員読込
========================================= */

async function loadEmployees() {
  const url =
    `${SUPABASE_URL}/rest/v1/employees` +
    `?select=id,name`;

  const response =
    await portalFetch(url);

  if (!response.ok) {
    throw new Error(
      "社員情報を読み込めませんでした"
    );
  }

  const employees =
    await response.json();

  employeeNameMap.clear();

  employees.forEach(
    employee => {

      employeeNameMap.set(
        String(employee.id),
        employee.name
      );
    }
  );
}


/* =========================================
   サイクル読込
========================================= */

async function loadCycle() {
  const {
    cycleId
  } = getParams();

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

  if (
    records.length === 0
  ) {
    throw new Error(
      "点検サイクルが見つかりません"
    );
  }

  currentCycle =
    records[0];

  inspectionResultBackLink.href =
    `tool-inspection-list.html?cycle=${currentCycle.id}`;
}


/* =========================================
   工具読込
========================================= */

async function loadTool() {
  const {
    toolId
  } = getParams();

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

  if (
    records.length === 0
  ) {
    throw new Error(
      "工具が見つかりません"
    );
  }

  currentTool =
    records[0];
}


/* =========================================
   点検結果読込
========================================= */

async function loadInspectionResult() {
  const url =
    `${SUPABASE_URL}/rest/v1/tool_inspections` +
    `?tool_id=eq.${currentTool.id}` +
    `&inspection_cycle=eq.${encodeURIComponent(
      currentCycle.cycle_code
    )}` +
    `&select=*` +
    `&order=created_at.desc` +
    `&limit=1`;

  const response =
    await portalFetch(url);

  if (!response.ok) {
    throw new Error(
      "点検結果を読み込めませんでした"
    );
  }

  const records =
    await response.json();

  if (
    records.length === 0
  ) {
    throw new Error(
      "点検結果が見つかりません"
    );
  }

  currentInspection =
    records[0];
}


/* =========================================
   表示
========================================= */

function displayResult() {
  resultToolName.textContent =
    `${currentTool.tool_name}` +
    `${
      currentTool.specification
        ? ` ${currentTool.specification}`
        : ""
    }`;

  resultToolGroup.textContent =
    currentTool.tool_group ||
    "その他";

  resultManagementCode.textContent =
    currentTool.management_code ||
    "-";

  resultSpecification.textContent =
    currentTool.specification ||
    "-";

  resultManufacturer.textContent =
    currentTool.manufacturer ||
    "-";

  resultModelNumber.textContent =
    currentTool.model_number ||
    "-";

  resultSerialNumber.textContent =
    currentTool.serial_number ||
    "-";

  resultInspectionCategory.textContent =
    formatInspectionCategory(
      currentTool.inspection_category
    );

  resultInspectionDate.textContent =
    currentInspection.inspection_date ||
    "-";

  resultInspector.textContent =
    currentInspection.inspector_employee_id
      ? (
          employeeNameMap.get(
            String(
              currentInspection.inspector_employee_id
            )
          ) || "-"
        )
      : "-";

  resultStickerNumber.textContent =
    currentInspection.sticker_number ||
    "-";

  resultJudgement.textContent =
    currentInspection.result ===
      "ok"
      ? "OK"
      : "NG";

  resultStickerConfirmed.textContent =
    currentInspection.sticker_confirmed
      ? "確認済み"
      : "未確認";

  resultDefectDetail.textContent =
    currentInspection.defect_detail ||
    "-";

  resultCorrectiveAction.textContent =
    currentInspection.corrective_action ||
    "-";

  resultNote.textContent =
    currentInspection.note ||
    "-";

  displayChecklist();
}


/* =========================================
   点検項目表示
========================================= */

function displayChecklist() {
  resultChecklist.innerHTML =
    "";

  const results =
    currentInspection.checklist_results ||
    {};

  const itemNumbers =
    Object.keys(results)
      .map(Number)
      .sort(
        (a, b) =>
          a - b
      );

  if (
    itemNumbers.length === 0
  ) {
    resultChecklist.innerHTML =
      `
        <p class="schedule-empty-message">
          点検項目の記録がありません
        </p>
      `;

    return;
  }

  itemNumbers.forEach(
    itemNumber => {

      const itemResult =
        results[
          String(itemNumber)
        ] || {};

      const checked =
        itemResult.checked ===
        true;

      const mark =
        itemResult.mark ||
        "";

      const row =
        document.createElement(
          "div"
        );

      row.className =
        "inspection-check-row";

      row.innerHTML =
        `
          <span>
            <strong>
              ${CIRCLE_NUMBERS[itemNumber]}
              ${
                mark === "▲"
                  ? "【▲】"
                  : ""
              }
            </strong>

            ${escapeHtml(
              INSPECTION_ITEMS[
                itemNumber
              ] || ""
            )}
          </span>

          <strong>
            ${
              checked
                ? "✓"
                : "－"
            }
          </strong>
        `;

      resultChecklist.appendChild(
        row
      );
    }
  );
}


/* =========================================
   初期化
========================================= */

async function initialize() {
  inspectionResultMessage.textContent =
    "";

  try {
    await Promise.all([
      loadEmployees(),
      loadCycle(),
      loadTool()
    ]);

    await loadInspectionResult();

    displayResult();

  } catch (error) {
    console.error(
      error
    );

    inspectionResultMessage.textContent =
      error.message;
  }
}


initialize();