(function initializePortalSideMenu() {
  "use strict";

  const loginUser = localStorage.getItem("portalLoginUser");
  const authSession = localStorage.getItem("portalAuthSession");

  function openPortalDeliveryCalendar(event) {
    if (event) {
      event.preventDefault();
    }

    const userAgent = navigator.userAgent || "";

    if (/Android/i.test(userAgent)) {
      window.location.href =
        "intent://calendar.google.com/calendar/u/0/r" +
        "#Intent;scheme=https;package=com.google.android.calendar;end";
      return;
    }

    if (/iPhone|iPad|iPod/i.test(userAgent)) {
      window.location.href = "com.google.calendar://";
      return;
    }

    window.open(
      "https://calendar.google.com/calendar/u/0/r",
      "_blank",
      "noopener"
    );
  }

  window.openPortalDeliveryCalendar = openPortalDeliveryCalendar;

  if (!loginUser || !authSession || !document.body) {
    return;
  }

  const root = document.createElement("div");
  root.className = "portal-side-menu-root";
  root.innerHTML = `
    <button
      type="button"
      class="portal-side-menu-toggle"
      aria-label="メニューを開く"
      aria-controls="portalSideMenuPanel"
      aria-expanded="false"
    >
      <span aria-hidden="true"></span>
      <span aria-hidden="true"></span>
      <span aria-hidden="true"></span>
    </button>

    <div class="portal-side-menu-overlay" aria-hidden="true"></div>

    <aside
      id="portalSideMenuPanel"
      class="portal-side-menu-panel"
      aria-label="共通メニュー"
      aria-hidden="true"
    >
      <div class="portal-side-menu-header">
        <div>
          <p class="portal-side-menu-kicker">Staff Portal</p>
          <h2 class="portal-side-menu-title">メニュー</h2>
        </div>
        <button
          type="button"
          class="portal-side-menu-close"
          aria-label="メニューを閉じる"
        >×</button>
      </div>

      <nav class="portal-side-menu-nav" aria-label="Staff Portalメニュー">
        <a class="portal-side-menu-link" href="home.html">
          <span>ホーム</span><span aria-hidden="true">›</span>
        </a>
        <a class="portal-side-menu-link" href="my-page.html">
          <span>マイページ</span><span aria-hidden="true">›</span>
        </a>
        <button type="button" class="portal-side-menu-link portal-side-menu-calendar">
          <span>現場搬入予定表</span><span aria-hidden="true">›</span>
        </button>
        <a class="portal-side-menu-link" href="tool-management.html">
          <span>工具管理</span><span aria-hidden="true">›</span>
        </a>
        <a class="portal-side-menu-link" href="settings.html">
          <span>設定</span><span aria-hidden="true">›</span>
        </a>
        <a class="portal-side-menu-link" href="help.html">
          <span>このアプリの使い方</span><span aria-hidden="true">›</span>
        </a>
      </nav>

      <button type="button" class="portal-side-menu-logout">
        ログアウト
      </button>
    </aside>
  `;

  document.body.classList.add("portal-side-menu-enabled");
  document.body.prepend(root);

  const toggle = root.querySelector(".portal-side-menu-toggle");
  const panel = root.querySelector(".portal-side-menu-panel");
  const overlay = root.querySelector(".portal-side-menu-overlay");
  const closeButton = root.querySelector(".portal-side-menu-close");
  const calendarButton = root.querySelector(".portal-side-menu-calendar");
  const logoutButton = root.querySelector(".portal-side-menu-logout");
  let isOpen = false;

  function openMenu() {
    if (isOpen) {
      return;
    }

    isOpen = true;
    root.classList.add("is-open");
    document.body.classList.add("portal-side-menu-open");
    toggle.setAttribute("aria-expanded", "true");
    toggle.setAttribute("aria-label", "メニューを閉じる");
    panel.setAttribute("aria-hidden", "false");
    overlay.setAttribute("aria-hidden", "false");
    closeButton.focus();
  }

  function closeMenu(restoreFocus = true) {
    if (!isOpen) {
      return;
    }

    isOpen = false;
    root.classList.remove("is-open");
    document.body.classList.remove("portal-side-menu-open");
    toggle.setAttribute("aria-expanded", "false");
    toggle.setAttribute("aria-label", "メニューを開く");
    panel.setAttribute("aria-hidden", "true");
    overlay.setAttribute("aria-hidden", "true");

    if (restoreFocus) {
      toggle.focus();
    }
  }

  toggle.addEventListener("click", () => {
    if (isOpen) {
      closeMenu();
    } else {
      openMenu();
    }
  });

  closeButton.addEventListener("click", () => closeMenu());
  overlay.addEventListener("click", () => closeMenu());

  calendarButton.addEventListener("click", event => {
    closeMenu();
    openPortalDeliveryCalendar(event);
  });

  logoutButton.addEventListener("click", () => {
    const confirmed = window.confirm("ログアウトしますか？");

    if (!confirmed) {
      return;
    }

    if (typeof window.clearPortalLoginInformation !== "function") {
      console.error("共通ログアウト処理を利用できません。");
      return;
    }

    window.clearPortalLoginInformation();
    window.location.href = "login.html";
  });

  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && isOpen) {
      closeMenu();
    }
  });
})();
