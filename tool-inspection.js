/* =========================================
   Supabase
========================================= */

const SUPABASE_URL =
  "https://fgmvmbjnoyagnpygcbky.supabase.co";


/* =========================================
   HTML要素
========================================= */

const inspectionCycleName =
  document.getElementById(
    "inspectionCycleName"
  );

const inspectionStartStickerNumber =
  document.getElementById(
    "inspectionStartStickerNumber"
  );

const startInspectionButton =
  document.getElementById(
    "startInspectionButton"
  );

const inspectionMessage =
  document.getElementById(
    "inspectionMessage"
  );

const inspectionCycleList =
  document.getElementById(
    "inspectionCycleList"
  );


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
   cycle_code作成
========================================= */

function createCycleCode() {
  const now =
    new Date();

  const year =
    now.getFullYear();

  const month =
    String(
      now.getMonth() + 1
    ).padStart(
      2,
      "0"
    );

  const seconds =
    String(
      now.getSeconds()
    ).padStart(
      2,
      "0"
    );

  return `${year}-${month}-${seconds}`;
}


/* =========================================
   点検開始
========================================= */

async function startInspectionCycle() {
  inspectionMessage.textContent =
    "";

  const cycleName =
    inspectionCycleName.value
      .trim();

  const startSticker =
    Number(
      inspectionStartStickerNumber.value
    );

  if (!cycleName) {
    inspectionMessage.textContent =
      "点検サイクル名を入力してください";

    return;
  }

  if (
    !startSticker ||
    startSticker < 1
  ) {
    inspectionMessage.textContent =
      "開始シール番号を入力してください";

    return;
  }

  const confirmed =
    window.confirm(
      `${cycleName}\n` +
      `開始シール番号：${startSticker}\n\n` +
      "この内容で半年点検を開始しますか？"
    );

  if (!confirmed) {
    return;
  }

  startInspectionButton.disabled =
    true;

  startInspectionButton.textContent =
    "開始中...";

  try {
    const loginUser =
      getLoginUser();

    const url =
      `${SUPABASE_URL}/rest/v1/tool_inspection_cycles`;

    const response =
      await portalFetch(
        url,
        {
          method: "POST",

          headers: {
            "Content-Type":
              "application/json",

            Prefer:
              "return=representation"
          },

          body:
            JSON.stringify({
              cycle_code:
                createCycleCode(),

              cycle_name:
                cycleName,

              start_sticker_number:
                startSticker,

              next_sticker_number:
                startSticker,

              status:
                "active",

              created_by_employee_id:
                loginUser
                  ? loginUser.id
                  : null,

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
        "半年点検を開始できませんでした"
      );
    }

    const records =
      await response.json();

    const createdCycle =
      records[0];

    inspectionCycleName.value =
      "";

    inspectionStartStickerNumber.value =
      "";

    await loadInspectionCycles();

    alert(
      "半年点検を開始しました"
    );

    window.location.href =
      `tool-inspection-list.html?cycle=${createdCycle.id}`;

  } catch (error) {
    console.error(error);

    inspectionMessage.textContent =
      error.message;

  } finally {
    startInspectionButton.disabled =
      false;

    startInspectionButton.textContent =
      "点検を開始";
  }
}


/* =========================================
   サイクル一覧読込
========================================= */

async function loadInspectionCycles() {
  inspectionCycleList.innerHTML =
    `
      <p class="schedule-empty-message">
        点検情報を読み込み中...
      </p>
    `;

  try {
    const url =
      `${SUPABASE_URL}/rest/v1/tool_inspection_cycles` +
      `?select=*` +
      `&order=created_at.desc`;

    const response =
      await portalFetch(url);

    if (!response.ok) {
      const errorText =
        await response.text();

      console.error(
        errorText
      );

      throw new Error(
        "点検サイクルを読み込めませんでした"
      );
    }

    const cycles =
      await response.json();

    displayInspectionCycles(
      cycles
    );

  } catch (error) {
    console.error(error);

    inspectionCycleList.innerHTML =
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
   サイクル一覧表示
========================================= */

function displayInspectionCycles(
  cycles
) {
  inspectionCycleList.innerHTML =
    "";

  if (cycles.length === 0) {
    inspectionCycleList.innerHTML =
      `
        <p class="schedule-empty-message">
          点検サイクルはまだありません
        </p>
      `;

    return;
  }

  cycles.forEach(cycle => {

    const card =
      document.createElement(
        "article"
      );

    card.className =
      "tool-item-card";

    let statusText =
      cycle.status;

    if (
      cycle.status ===
      "preparing"
    ) {
      statusText =
        "準備中";
    }

    if (
      cycle.status ===
      "active"
    ) {
      statusText =
        "点検中";
    }

    if (
      cycle.status ===
      "completed"
    ) {
      statusText =
        "完了";
    }

    card.innerHTML =
      `
        <div class="tool-item-main">

          <h3>
            ${escapeHtml(
              cycle.cycle_name
            )}
          </h3>

          <p>
            状態：
            ${escapeHtml(
              statusText
            )}
          </p>

          <p>
            開始シール番号：
            ${escapeHtml(
              cycle.start_sticker_number
            )}
          </p>

          <p>
            次回シール番号：
            ${escapeHtml(
              cycle.next_sticker_number
            )}
          </p>

        </div>

        <div class="tool-item-actions">

          <a
            href="tool-inspection-list.html?cycle=${cycle.id}"
            class="admin-primary-button"
          >
            開く
          </a>

        </div>
      `;

    inspectionCycleList.appendChild(
      card
    );
  });
}


/* =========================================
   イベント
========================================= */

startInspectionButton.addEventListener(
  "click",
  startInspectionCycle
);


/* =========================================
   初期表示
========================================= */

loadInspectionCycles();