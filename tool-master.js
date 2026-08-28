/* =========================================
   Supabase接続設定
========================================= */

const SUPABASE_URL =
  "https://fgmvmbjnoyagnpygcbky.supabase.co";


/* =========================================
   HTML要素
========================================= */

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

const toolMasterSearch =
  document.getElementById(
    "toolMasterSearch"
  );

const toolMasterList =
  document.getElementById(
    "toolMasterList"
  );

const editingToolId =
  document.getElementById(
    "editingToolId"
  );

const toolFormTitle =
  document.getElementById(
    "toolFormTitle"
  );


/* =========================================
   現在読み込んでいる工具
========================================= */

let toolRecords = [];


/* =========================================
   共通処理
========================================= */

function escapeHtml(value) {
  return String(value ?? "")
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


/* =========================================
   状態表示
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


/* =========================================
   入力データ取得
========================================= */

function createToolData() {
  return {
    tool_group:
      toolGroup.value ||
      null,

    management_code:
      toolManagementCode.value
        .trim(),

    tool_name:
      toolName.value
        .trim(),

    specification:
      toolSpecification.value
        .trim() || null,

    ownership_type:
      toolOwnershipType.value,

    manufacturer:
      toolManufacturer.value
        .trim() || null,

    model_number:
      toolModelNumber.value
        .trim() || null,

    serial_number:
      toolSerialNumber.value
        .trim() || null,

    performance:
      toolPerformance.value
        .trim() || null,

    inspection_required:
      toolInspectionRequired.value ===
      "true",

    inspection_category:
      toolInspectionCategory.value ||
      null,

    note:
      toolNote.value
        .trim() || null,

    updated_at:
      new Date().toISOString()
  };
}


/* =========================================
   入力確認
========================================= */

function validateTool() {
  if (!toolGroup.value) {
    throw new Error(
      "大分類を選択してください"
    );
  }

  if (!toolName.value.trim()) {
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
}


/* =========================================
   工具保存
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

  saveToolButton.disabled =
    true;

  saveToolButton.textContent =
    isEditing
      ? "保存中..."
      : "登録中...";

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
      const errorText =
        await response.text();

      console.error(
        errorText
      );

      throw new Error(
        isEditing
          ? "工具情報を保存できませんでした"
          : "工具を登録できませんでした"
      );
    }

    resetToolForm();

    await loadTools();

    showToolMessage(
      isEditing
        ? "工具情報を保存しました"
        : "工具を登録しました"
    );

  } catch (error) {
    console.error(error);

    showToolMessage(
      error.message
    );

  } finally {
    saveToolButton.disabled =
      false;

    saveToolButton.textContent =
      editingToolId.value
        ? "保存する"
        : "登録する";
  }
}


/* =========================================
   工具編集開始
========================================= */

function startToolEdit(
  tool
) {
  clearToolMessage();

  editingToolId.value =
    tool.id;

  toolFormTitle.textContent =
    "工具情報の修正";

  toolGroup.value =
    tool.tool_group || "";

  toolName.value =
    tool.tool_name || "";

  toolSpecification.value =
    tool.specification || "";

  toolManagementCode.value =
    tool.management_code || "";

  toolOwnershipType.value =
    tool.ownership_type ||
    "shared";

  toolManufacturer.value =
    tool.manufacturer || "";

  toolModelNumber.value =
    tool.model_number || "";

  toolSerialNumber.value =
    tool.serial_number || "";

  toolPerformance.value =
    tool.performance || "";

  toolInspectionRequired.value =
    String(
      tool.inspection_required
    );

  toolInspectionCategory.value =
    tool.inspection_category || "";

  toolNote.value =
    tool.note || "";

  saveToolButton.textContent =
    "保存する";

  cancelToolEditButton.hidden =
    false;

  if (
    tool.status === "disposed"
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

  toolFormTitle.scrollIntoView({
    behavior: "smooth",
    block: "start"
  });
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

  toolName.value =
    "";

  toolSpecification.value =
    "";

  toolManagementCode.value =
    "";

  toolOwnershipType.value =
    "shared";

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

  cancelToolEditButton.hidden =
    true;

  stopToolButton.hidden =
    true;

  disposeToolButton.hidden =
    true;
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
      `${toolName.value}を使用停止にしますか？`
    );

  if (!confirmed) {
    return;
  }

  stopToolButton.disabled =
    true;

  try {
    const url =
      `${SUPABASE_URL}/rest/v1/tools` +
      `?id=eq.${toolId}`;

    const response =
      await portalFetch(
        url,
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
      const errorText =
        await response.text();

      console.error(
        errorText
      );

      throw new Error(
        "使用停止にできませんでした"
      );
    }

    resetToolForm();

    await loadTools();

    showToolMessage(
      "工具を使用停止にしました"
    );

  } catch (error) {
    console.error(error);

    showToolMessage(
      error.message
    );

  } finally {
    stopToolButton.disabled =
      false;
  }
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

  if (reason === null) {
    return;
  }

  if (!reason.trim()) {
    alert(
      "廃棄理由を入力してください"
    );

    return;
  }

  const confirmed =
    window.confirm(
      `${toolName.value}を廃棄扱いにしますか？\n\n` +
      "過去の履歴は残ります。"
    );

  if (!confirmed) {
    return;
  }

  disposeToolButton.disabled =
    true;

  try {
    const today =
      new Date();

    const year =
      today.getFullYear();

    const month =
      String(
        today.getMonth() + 1
      ).padStart(
        2,
        "0"
      );

    const day =
      String(
        today.getDate()
      ).padStart(
        2,
        "0"
      );

    const disposedDate =
      `${year}-${month}-${day}`;

    const url =
      `${SUPABASE_URL}/rest/v1/tools` +
      `?id=eq.${toolId}`;

    const response =
      await portalFetch(
        url,
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
      const errorText =
        await response.text();

      console.error(
        errorText
      );

      throw new Error(
        "工具を廃棄にできませんでした"
      );
    }

    resetToolForm();

    await loadTools();

    showToolMessage(
      "工具を廃棄扱いにしました"
    );

  } catch (error) {
    console.error(error);

    showToolMessage(
      error.message
    );

  } finally {
    disposeToolButton.disabled =
      false;
  }
}


/* =========================================
   工具一覧読込
========================================= */

async function loadTools() {
  toolMasterList.innerHTML =
    `
      <p class="schedule-empty-message">
        工具情報を読み込み中...
      </p>
    `;

  try {
    const url =
      `${SUPABASE_URL}/rest/v1/tools` +
      `?select=*` +
      `&order=tool_name.asc,management_code.asc`;

    const response =
      await portalFetch(
        url
      );

    if (!response.ok) {
      const errorText =
        await response.text();

      console.error(
        errorText
      );

      throw new Error(
        "工具情報を読み込めませんでした"
      );
    }

    toolRecords =
      await response.json();

    displayTools();

  } catch (error) {
    console.error(error);

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


/* =========================================
   工具一覧表示
========================================= */

function displayTools() {
  const searchText =
    toolMasterSearch.value
      .trim()
      .toLowerCase();

  const filteredTools =
    toolRecords.filter(
      tool => {

        if (!searchText) {
          return true;
        }

        const text =
          [
            tool.tool_group,
            tool.tool_name,
            tool.management_code,
            tool.specification,
            tool.manufacturer,
            tool.model_number,
            tool.serial_number
          ]
            .filter(Boolean)
            .join(" ")
            .toLowerCase();

        return text.includes(
          searchText
        );
      }
    );

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

      card.className =
        "tool-item-card";

      const ownershipText =
  tool.ownership_type === "personal"
    ? "個人（会社社員）"
    : tool.ownership_type === "contractor"
      ? "協力業者"
      : "共有（会社）";

      const inspectionText =
        tool.inspection_required
          ? "対象"
          : "対象外";

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
              ${escapeHtml(
                inspectionText
              )}
            </p>

            ${
              tool.status ===
                "disposed"
                ? `
                  <p>
                    廃棄日：
                    ${escapeHtml(
                      tool.disposed_at ||
                      "-"
                    )}
                  </p>

                  <p>
                    廃棄理由：
                    ${escapeHtml(
                      tool.disposal_reason ||
                      "-"
                    )}
                  </p>
                `
                : ""
            }

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

      const editButton =
        card.querySelector(
          ".edit-tool-button"
        );

      editButton.addEventListener(
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

saveToolButton.addEventListener(
  "click",
  saveTool
);

cancelToolEditButton.addEventListener(
  "click",
  () => {
    resetToolForm();

    clearToolMessage();
  }
);

stopToolButton.addEventListener(
  "click",
  stopTool
);

disposeToolButton.addEventListener(
  "click",
  disposeTool
);

toolMasterSearch.addEventListener(
  "input",
  displayTools
);


/* =========================================
   初期表示
========================================= */

loadTools();