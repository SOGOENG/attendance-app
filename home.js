/* =========================================
   Supabase接続設定
========================================= */

const SUPABASE_URL =
  "https://fgmvmbjnoyagnpygcbky.supabase.co";


/* =========================================
   HTML要素
========================================= */

const welcomeMessage =
  document.getElementById(
    "welcomeMessage"
  );

const logoutButton =
  document.getElementById(
    "logoutButton"
  );

const adminMenu =
  document.getElementById(
    "adminMenu"
  );

const toolManagementMenu =
  document.getElementById(
    "toolManagementMenu"
  );

const todayScheduleList =
  document.getElementById(
    "todayScheduleList"
  );

const improvementThemeSummary =
  document.getElementById(
    "improvementThemeSummary"
  );


/* =========================================
   ログイン情報取得
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


/* =========================================
   ホーム画面表示
========================================= */

function showHomeScreen() {
  const loginUser =
    getLoginUser();

  /*
    ログイン情報がない場合は
    ログイン画面へ戻す
  */

  if (!loginUser) {
    window.location.href =
      "login.html";

    return;
  }

  welcomeMessage.textContent =
    `${loginUser.name}さん、お疲れさまです`;


  /*
    工具管理権限がある場合、
    工具管理メニューを表示する
  */

  if (toolManagementMenu) {
  toolManagementMenu.classList.remove(
    "hidden"
  );
}
  /*
    通常の管理権限がある場合だけ、
    管理画面メニューを表示する
  */

  if (
    loginUser.adminScope &&
    loginUser.adminScope !== "none" &&
    loginUser.adminScope !== "tool_admin"
  ) {
    if (adminMenu) {
      adminMenu.classList.remove(
        "hidden"
      );
    }
  }


  /*
    本日の予定を読み込む
  */

  loadTodaySchedules(loginUser)
    .catch(error => {
      console.error(error);

      todayScheduleList.innerHTML =
        '<p class="schedule-empty-message">' +
        `${escapeHtml(error.message)}` +
        '</p>';
    });


  /*
    公開中の向上提案テーマを読み込む
  */

  loadImprovementTheme()
    .catch(error => {
      console.error(error);

      if (improvementThemeSummary) {
        improvementThemeSummary.textContent =
          "今月のテーマを読み込めませんでした";
      }
    });


  loadHomeSubmissionWarning();
}


/* =========================================
   今日の日付取得
========================================= */

function todayDateValue() {
  const date = new Date();

  const year =
    date.getFullYear();

  const month =
    String(
      date.getMonth() + 1
    ).padStart(2, "0");

  const day =
    String(
      date.getDate()
    ).padStart(2, "0");

  return `${year}-${month}-${day}`;
}


/* =========================================
   時刻表示
========================================= */

function formatScheduleTime(
  timeText
) {
  if (!timeText) {
    return "";
  }

  return timeText.slice(0, 5);
}


/* =========================================
   HTML用文字変換
========================================= */

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}


/* =========================================
   今日・明日の予定読込
========================================= */

async function loadTodaySchedules(
  loginUser
) {
  if (!todayScheduleList) {
    return;
  }

  todayScheduleList.innerHTML =
    '<p class="schedule-empty-message">' +
    '予定を読み込み中...' +
    '</p>';

  const today =
    new Date();

  const tomorrow =
    new Date(
      today.getFullYear(),
      today.getMonth(),
      today.getDate() + 1
    );

  /*
    YYYY-MM-DD形式へ変換
  */

  function toLocalDateString(
    date
  ) {
    const year =
      date.getFullYear();

    const month =
      String(
        date.getMonth() + 1
      ).padStart(2, "0");

    const day =
      String(
        date.getDate()
      ).padStart(2, "0");

    return `${year}-${month}-${day}`;
  }

  const todayText =
    toLocalDateString(today);

  const tomorrowText =
    toLocalDateString(tomorrow);

  /*
    今日〜明日の予定を取得
  */

  const url =
    `${SUPABASE_URL}/rest/v1/schedules` +
    `?select=*` +
    `&schedule_date=gte.${todayText}` +
    `&schedule_date=lte.${tomorrowText}` +
    `&order=schedule_date.asc,start_time.asc`;

  const response =
    await portalFetch(url);

  if (!response.ok) {
    const errorText =
      await response.text();

    console.error(errorText);

    throw new Error(
      "今日・明日の予定を読み込めませんでした"
    );
  }

  const schedules =
    await response.json();

  const userDepartment =
    loginUser.department || "";

  /*
    全員向け、または
    ログインした人の部署向けだけ表示
  */

  const visibleSchedules =
    schedules.filter(item => {
      return (
        item.target_scope === "all" ||
        item.target_scope ===
          userDepartment
      );
    });

  renderTodaySchedules(
    visibleSchedules
  );
}


/* =========================================
   今日・明日の予定表示
========================================= */

function renderTodaySchedules(
  schedules
) {
  todayScheduleList.innerHTML = "";

  const today =
    new Date();

  const tomorrow =
    new Date(
      today.getFullYear(),
      today.getMonth(),
      today.getDate() + 1
    );

  /*
    日付をYYYY-MM-DD形式へ変換
  */

  function toLocalDateString(
    date
  ) {
    const year =
      date.getFullYear();

    const month =
      String(
        date.getMonth() + 1
      ).padStart(2, "0");

    const day =
      String(
        date.getDate()
      ).padStart(2, "0");

    return `${year}-${month}-${day}`;
  }

  const todayText =
    toLocalDateString(today);

  const tomorrowText =
    toLocalDateString(tomorrow);

  /*
    今日と明日の予定を分ける
  */

  const todaySchedules =
    schedules.filter(
      item =>
        item.schedule_date ===
        todayText
    );

  const tomorrowSchedules =
    schedules.filter(
      item =>
        item.schedule_date ===
        tomorrowText
    );

  /*
    1日分の予定を表示
  */

  function renderDaySchedules(
    label,
    daySchedules,
    emptyMessage
  ) {
    if (
      daySchedules.length === 0
    ) {
      const emptyRow =
        document.createElement(
          "p"
        );

      emptyRow.className =
        "schedule-empty-message";

      emptyRow.textContent =
        emptyMessage;

      todayScheduleList.appendChild(
        emptyRow
      );

      return;
    }

    daySchedules.forEach(item => {
      const scheduleRow =
        document.createElement(
          "div"
        );

      scheduleRow.className =
        "today-schedule-row";

      const timeText =
        formatScheduleTime(
          item.start_time
        );

      scheduleRow.innerHTML = `
        <span class="today-schedule-day">
          ${label}
        </span>

        ${
          timeText
            ? `
              <span class="today-schedule-time">
                ${escapeHtml(timeText)}
              </span>
            `
            : ""
        }

        <span class="today-schedule-title">
          ${escapeHtml(item.title)}
        </span>
      `;

      todayScheduleList.appendChild(
        scheduleRow
      );
    });
  }

  renderDaySchedules(
    "本日",
    todaySchedules,
    "本日の予定はありません。"
  );

  renderDaySchedules(
    "明日",
    tomorrowSchedules,
    "明日の予定はありません。"
  );
}


/* =========================================
   向上提案テーマ読込
========================================= */

async function loadImprovementTheme() {
  if (!improvementThemeSummary) {
    return;
  }

  improvementThemeSummary.textContent =
    "今月のテーマを読み込み中...";

  const url =
    `${SUPABASE_URL}/rest/v1/improvement_settings` +
    `?select=target_month,monthly_theme,deadline,issue_number` +
    `&is_published=eq.true` +
    `&order=target_month.desc` +
    `&limit=1`;

  const response =
    await portalFetch(url);

  if (!response.ok) {
    const errorText =
      await response.text();

    console.error(errorText);

    throw new Error(
      "向上提案テーマを取得できませんでした"
    );
  }

  const settings =
    await response.json();

  if (
    settings.length === 0
  ) {
    improvementThemeSummary.textContent =
      "今月のテーマは準備中です";

    return;
  }

  const setting =
    settings[0];

  const targetDate =
    new Date(
      `${setting.target_month}T00:00:00`
    );

  const targetMonth =
    targetDate.getMonth() + 1;

  const themeText =
    setting.monthly_theme || "";

  const summaryText =
    themeText.length > 28
      ? `${themeText.slice(0, 28)}…`
      : themeText;

  improvementThemeSummary.textContent =
    `${targetMonth}月のテーマ：${summaryText}`;
}


/* =========================================
   マイページ未提出警告
========================================= */

async function loadHomeSubmissionWarning() {
  const warningElement =
    document.getElementById(
      "homeSubmissionWarning"
    );

  if (!warningElement) {
    return;
  }

  warningElement.classList.add(
    "hidden"
  );

  try {
    const [
      attendanceSubmission,
      improvementSubmission,
      nearMissSubmission
    ] =
      await Promise.all([
        loadAttendanceSubmissionStatus(),
        loadImprovementSubmissionStatus(),
        loadNearMissSubmissionStatus()
      ]);

    const hasOverdueSubmission =
      isMyPageSubmissionOverdue(
        attendanceSubmission
      ) ||
      isMyPageSubmissionOverdue(
        improvementSubmission
      ) ||
      isMyPageSubmissionOverdue(
        nearMissSubmission
      );

    if (hasOverdueSubmission) {
      warningElement.classList.remove(
        "hidden"
      );
    }

  } catch (error) {
    console.error(error);
  }
}


/* =========================================
   ログアウト
========================================= */

function logout() {
  const confirmed =
    window.confirm(
      "ログアウトしますか？"
    );

  if (!confirmed) {
    return;
  }

  clearPortalLoginInformation();

  window.location.href =
    "login.html";
}


/* =========================================
   イベント設定
========================================= */

logoutButton.addEventListener(
  "click",
  logout
);


/* =========================================
   初期表示
========================================= */

showHomeScreen();


/* =========================================
   本日の予定カードに日付表示
========================================= */

function displayTodayDate() {
  const today =
    new Date();

  const monthElement =
    document.getElementById(
      "todayDateMonth"
    );

  const dayElement =
    document.getElementById(
      "todayDateDay"
    );

  if (
    !monthElement ||
    !dayElement
  ) {
    return;
  }

  monthElement.textContent =
    `${today.getMonth() + 1}月`;

  dayElement.textContent =
    today.getDate();
}

displayTodayDate();


/* =========================================
   Service Worker登録
========================================= */

if (
  "serviceWorker" in navigator
) {
  window.addEventListener(
    "load",
    () => {
      navigator.serviceWorker
        .register(
          "./service-worker.js"
        )
        .then(registration => {
          console.log(
            "Service Worker登録成功",
            registration.scope
          );
        })
        .catch(error => {
          console.error(
            "Service Worker登録失敗",
            error
          );
        });
    }
  );
}


/* =========================================
   Googleカレンダーアプリを開く
========================================= */

const deliveryCalendarLink =
  document.getElementById(
    "deliveryCalendarLink"
  );

function openGoogleCalendar(
  event
) {
  event.preventDefault();

  const userAgent =
    navigator.userAgent || "";

  const isAndroid =
    /Android/i.test(
      userAgent
    );

  const isIPhoneOrIPad =
    /iPhone|iPad|iPod/i.test(
      userAgent
    );

  /*
    Android
    Googleカレンダーアプリを指定して開く
  */

  if (isAndroid) {
    window.location.href =
      "intent://calendar.google.com/calendar/u/0/r" +
      "#Intent;" +
      "scheme=https;" +
      "package=com.google.android.calendar;" +
      "end";

    return;
  }

  /*
    iPhone・iPad
    Googleカレンダーアプリを開く
  */

  if (isIPhoneOrIPad) {
    window.location.href =
      "com.google.calendar://";

    return;
  }

  /*
    パソコン
    GoogleカレンダーのWeb版を開く
  */

  window.open(
    "https://calendar.google.com/calendar/u/0/r",
    "_blank",
    "noopener"
  );
}

if (deliveryCalendarLink) {
  deliveryCalendarLink
    .addEventListener(
      "click",
      openGoogleCalendar
    );
}


/* =========================================
   Push通知 ON / OFF
========================================= */

const pushNotificationButton =
  document.getElementById(
    "pushNotificationButton"
  );


async function updatePushNotificationButton() {
  if (!pushNotificationButton) {
    return;
  }

  if (
    typeof window.isPushSupported !==
      "function" ||
    !window.isPushSupported()
  ) {
    pushNotificationButton.textContent =
      "🔕 通知は利用できません";

    pushNotificationButton.disabled =
      true;

    return;
  }

  try {
    const enabled =
      await window.isPushEnabled();

    if (enabled) {
      pushNotificationButton.textContent =
        "🔔 通知ON";
    } else {
      pushNotificationButton.textContent =
        "🔕 通知OFF";
    }

    pushNotificationButton.disabled =
      false;

  } catch (error) {
    console.error(
      "通知状態確認エラー:",
      error
    );

    pushNotificationButton.textContent =
      "🔔 通知を受け取る";

    pushNotificationButton.disabled =
      false;
  }
}


async function togglePushNotifications() {
  if (!pushNotificationButton) {
    return;
  }

  pushNotificationButton.disabled =
    true;

  try {
    const enabled =
      await window.isPushEnabled();

    if (enabled) {
      await window.disablePushNotifications();

      alert(
        "通知をOFFにしました"
      );

    } else {
      await window.enablePushNotifications();

      alert(
        "通知をONにしました"
      );
    }

  } catch (error) {
    console.error(
      "通知設定エラー:",
      error
    );

    alert(
      error.message ||
      "通知設定に失敗しました"
    );
  }

  await updatePushNotificationButton();
}


if (pushNotificationButton) {
  pushNotificationButton.addEventListener(
    "click",
    togglePushNotifications
  );

  updatePushNotificationButton();

  if (
    typeof window.syncPushSubscription ===
      "function"
  ) {
    window.syncPushSubscription()
      .catch(error => {
        console.error(
          "Push購読同期エラー:",
          error
        );
      });
  }
}
