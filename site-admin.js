/* =========================================
   現場設定
========================================= */

const SUPABASE_URL =
  "https://fgmvmbjnoyagnpygcbky.supabase.co";


/* =========================================
   HTML要素
========================================= */

const newSiteButton =
  document.getElementById(
    "newSiteButton"
  );

const siteSearchInput =
  document.getElementById(
    "siteSearchInput"
  );

const siteVisibleFilter =
  document.getElementById(
    "siteVisibleFilter"
  );

const siteTypeFilter =
  document.getElementById(
    "siteTypeFilter"
  );

const siteMessage =
  document.getElementById(
    "siteMessage"
  );

const siteList =
  document.getElementById(
    "siteList"
  );

const siteEditSection =
  document.getElementById(
    "siteEditSection"
  );

const siteFormTitle =
  document.getElementById(
    "siteFormTitle"
  );

const editingSiteId =
  document.getElementById(
    "editingSiteId"
  );

const siteDisplayOrder =
  document.getElementById(
    "siteDisplayOrder"
  );

const siteDisplayName =
  document.getElementById(
    "siteDisplayName"
  );

const siteInputCode =
  document.getElementById(
    "siteInputCode"
  );

const siteConstructionNo =
  document.getElementById(
    "siteConstructionNo"
  );

const siteClientCode =
  document.getElementById(
    "siteClientCode"
  );

const siteClientName =
  document.getElementById(
    "siteClientName"
  );

const siteOfficialName =
  document.getElementById(
    "siteOfficialName"
  );

const siteVisible =
  document.getElementById(
    "siteVisible"
  );

const siteType =
  document.getElementById(
    "siteType"
  );

const saveSiteButton =
  document.getElementById(
    "saveSiteButton"
  );

const cancelSiteEditButton =
  document.getElementById(
    "cancelSiteEditButton"
  );


/* =========================================
   現在使用中のデータ
========================================= */

let siteRecords = [];


/* =========================================
   管理者権限確認
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
    return JSON.parse(savedUser);

  } catch (error) {
    console.error(error);
    return null;
  }
}


function checkAdminAccess() {
  const loginUser =
    getLoginUser();

  if (!loginUser) {
    window.location.href =
      "login.html";

    return false;
  }

  if (
  !loginUser.adminScope ||
  loginUser.adminScope === "none" ||
  loginUser.adminScope === "tool_admin"
) {
  
    alert(
      "現場設定を開く権限がありません"
    );

    window.location.href =
      "home.html";

    return false;
  }

  return true;
}


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


function showMessage(message) {
  siteMessage.textContent =
    message;
}


function clearMessage() {
  siteMessage.textContent =
    "";
}


function formatVisible(value) {
  return value
    ? "表示中"
    : "非表示";
}


/* =========================================
   現場一覧取得
========================================= */

async function loadSites() {
  siteList.innerHTML =
    `
      <p class="schedule-empty-message">
        現場情報を読み込み中...
      </p>
    `;

  try {
    const url =
      `${SUPABASE_URL}/rest/v1/sites` +
      `?select=*` +
      `&order=display_order.asc,display_name.asc`;

    const response =
      await portalFetch(url);

    if (!response.ok) {
      const errorText =
        await response.text();

      console.error(errorText);

      throw new Error(
        "現場情報を読み込めませんでした"
      );
    }

    siteRecords =
      await response.json();

    displaySites();

  } catch (error) {
    console.error(error);

    siteList.innerHTML =
      `
        <p class="schedule-empty-message">
          ${escapeHtml(error.message)}
        </p>
      `;
  }
}


/* =========================================
   絞り込み済み現場取得
========================================= */

function getFilteredSites() {
  const searchText =
    siteSearchInput.value
      .trim()
      .toLowerCase();

  const visibleValue =
    siteVisibleFilter.value;

  const typeValue =
    siteTypeFilter.value;

  return siteRecords.filter(
    site => {
      const searchMatches =
        !searchText ||
        String(site.display_name || "")
          .toLowerCase()
          .includes(searchText) ||
        String(site.official_name || "")
          .toLowerCase()
          .includes(searchText) ||
        String(site.construction_no || "")
          .toLowerCase()
          .includes(searchText) ||
        String(site.input_code || "")
          .toLowerCase()
          .includes(searchText) ||
        String(site.client_name || "")
          .toLowerCase()
          .includes(searchText);

      const visibleMatches =
        visibleValue === "all" ||
        String(site.visible) ===
          visibleValue;

      const typeMatches =
        typeValue === "all" ||
        site.site_type ===
          typeValue;

      return (
        searchMatches &&
        visibleMatches &&
        typeMatches
      );
    }
  );
}


/* =========================================
   現場一覧表示
========================================= */

function displaySites() {
  const filteredSites =
    getFilteredSites();

  siteList.innerHTML =
    "";

  if (filteredSites.length === 0) {
    siteList.innerHTML =
      `
        <p class="schedule-empty-message">
          該当する現場はありません
        </p>
      `;

    return;
  }

  filteredSites.forEach(
    site => {
      const card =
        createSiteCard(site);

      siteList.appendChild(
        card
      );
    }
  );
}


/* =========================================
   現場カード作成
========================================= */

function createSiteCard(site) {
  const card =
    document.createElement("div");

  card.className =
    "admin-schedule-item";

  card.innerHTML =
    `
      <div class="admin-schedule-info">

        <strong>
          ${escapeHtml(site.display_name)}
        </strong>

        <p>
          表示順：
          ${escapeHtml(site.display_order)}
        </p>

        <p>
          入力コード：
          ${escapeHtml(site.input_code)}
        </p>

        <p>
          工事番号：
          ${escapeHtml(site.construction_no)}
        </p>

        <p>
          元請：
          ${escapeHtml(site.client_name)}
        </p>

        <p>
          正式名称：
          ${escapeHtml(site.official_name)}
        </p>

        <p>
          現場種別：
          ${escapeHtml(site.site_type)}
        </p>

        <p>
          状態：
          ${escapeHtml(
            formatVisible(site.visible)
          )}
        </p>

      </div>

      <div class="admin-schedule-actions">

        <button
          type="button"
          class="edit-schedule-button"
        >
          編集
        </button>

      </div>
    `;

  const editButton =
    card.querySelector(
      ".edit-schedule-button"
    );

  editButton.addEventListener(
    "click",
    () => {
      startSiteEdit(site);
    }
  );

  return card;
}


/* =========================================
   新規現場登録開始
========================================= */

function startNewSiteRegistration() {
  editingSiteId.value =
    "";

  siteFormTitle.textContent =
    "新規現場登録";

  const nextDisplayOrder =
    siteRecords.length > 0
      ? Math.max(
          ...siteRecords.map(
            site =>
              Number(site.display_order) || 0
          )
        ) + 1
      : 1;

  siteDisplayOrder.value =
    String(nextDisplayOrder);

  siteDisplayName.value =
    "";

  siteInputCode.value =
    "";

  siteConstructionNo.value =
    "";

  siteClientCode.value =
    "";

  siteClientName.value =
    "";

  siteOfficialName.value =
    "";

  siteVisible.value =
    "true";

  siteType.value =
    "一般";

  siteEditSection.hidden =
    false;

  clearMessage();

  siteEditSection.scrollIntoView({
    behavior:
      "smooth",

    block:
      "start"
  });
}


/* =========================================
   現場編集開始
========================================= */

function startSiteEdit(site) {
  editingSiteId.value =
    site.id;

  siteFormTitle.textContent =
    "現場情報の修正";

  siteDisplayOrder.value =
    site.display_order ?? "";

  siteDisplayName.value =
    site.display_name || "";

  siteInputCode.value =
    site.input_code || "";

  siteConstructionNo.value =
    site.construction_no || "";

  siteClientCode.value =
    site.client_code || "";

  siteClientName.value =
    site.client_name || "";

  siteOfficialName.value =
    site.official_name || "";

  siteVisible.value =
    String(site.visible);

  siteType.value =
    site.site_type || "一般";

  siteEditSection.hidden =
    false;

  clearMessage();

  siteEditSection.scrollIntoView({
    behavior:
      "smooth",

    block:
      "start"
  });
}


/* =========================================
   保存用データ作成
========================================= */

function createSiteSaveData() {
  return {
    display_order:
      Number(siteDisplayOrder.value),

    display_name:
      siteDisplayName.value.trim(),

    input_code:
      siteInputCode.value.trim(),

    construction_no:
      siteConstructionNo.value.trim(),

    client_code:
      siteClientCode.value.trim(),

    client_name:
      siteClientName.value.trim(),

    official_name:
      siteOfficialName.value.trim(),

    visible:
      siteVisible.value === "true",

    site_type:
      siteType.value
  };
}


/* =========================================
   入力確認
========================================= */

function validateSite() {
  if (
    !siteDisplayOrder.value ||
    Number(siteDisplayOrder.value) < 1
  ) {
    throw new Error(
      "表示順を入力してください"
    );
  }

  if (!siteDisplayName.value.trim()) {
    throw new Error(
      "表示名を入力してください"
    );
  }

  if (!siteInputCode.value.trim()) {
    throw new Error(
      "入力コードを入力してください"
    );
  }

  if (!siteConstructionNo.value.trim()) {
    throw new Error(
      "工事番号を入力してください"
    );
  }

  if (!siteClientName.value.trim()) {
    throw new Error(
      "元請名を入力してください"
    );
  }

  if (!siteOfficialName.value.trim()) {
    throw new Error(
      "正式名称を入力してください"
    );
  }
}


/* =========================================
   現場情報保存
========================================= */

async function saveSite() {
  clearMessage();

  try {
    validateSite();

  } catch (error) {
    showMessage(
      error.message
    );

    return;
  }

  const siteId =
    editingSiteId.value;

  const isNewSite =
    !siteId;

  const saveData =
    createSiteSaveData();

  const confirmed =
    window.confirm(
      isNewSite
        ? "新規現場を登録しますか？"
        : "現場情報を保存しますか？"
    );

  if (!confirmed) {
    return;
  }

  saveSiteButton.disabled =
    true;

  saveSiteButton.textContent =
    isNewSite
      ? "登録中..."
      : "保存中...";

  try {
    let url =
      `${SUPABASE_URL}/rest/v1/sites`;

    let method =
      "POST";

    if (!isNewSite) {
      url +=
        `?id=eq.${siteId}`;

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
              saveData
            )
        }
      );

    if (!response.ok) {
      const errorText =
        await response.text();

      console.error(errorText);

      throw new Error(
        isNewSite
          ? "新規現場を登録できませんでした"
          : "現場情報を保存できませんでした"
      );
    }

    await loadSites();

    closeSiteEdit();

    showMessage(
      isNewSite
        ? "新規現場を登録しました"
        : "現場情報を保存しました"
    );

  } catch (error) {
    console.error(error);

    showMessage(
      error.message
    );

  } finally {
    saveSiteButton.disabled =
      false;

    saveSiteButton.textContent =
      "保存する";
  }
}


/* =========================================
   編集画面を閉じる
========================================= */

function closeSiteEdit() {
  editingSiteId.value =
    "";

  siteFormTitle.textContent =
    "現場情報の修正";

  siteEditSection.hidden =
    true;
}


/* =========================================
   イベント設定
========================================= */

newSiteButton.addEventListener(
  "click",
  startNewSiteRegistration
);


siteSearchInput.addEventListener(
  "input",
  displaySites
);


siteVisibleFilter.addEventListener(
  "change",
  displaySites
);


siteTypeFilter.addEventListener(
  "change",
  displaySites
);


saveSiteButton.addEventListener(
  "click",
  saveSite
);


cancelSiteEditButton.addEventListener(
  "click",
  () => {
    closeSiteEdit();

    clearMessage();
  }
);


/* =========================================
   初期表示
========================================= */

async function initializeSiteAdmin() {
  if (!checkAdminAccess()) {
    return;
  }

  await loadSites();
}


initializeSiteAdmin();