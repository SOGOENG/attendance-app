/* =========================================
   休日カレンダー設定
========================================= */

const SUPABASE_URL =
  "https://fgmvmbjnoyagnpygcbky.supabase.co";


/* =========================================
   HTML要素
========================================= */

const fiscalYearSelect =
  document.getElementById(
    "fiscalYearSelect"
  );

const monthSelect =
  document.getElementById(
    "monthSelect"
  );

const createDefaultCalendarButton =
  document.getElementById(
    "createDefaultCalendarButton"
  );

const saveCalendarButton =
  document.getElementById(
    "saveCalendarButton"
  );

const previousMonthButton =
  document.getElementById(
    "previousMonthButton"
  );

const nextMonthButton =
  document.getElementById(
    "nextMonthButton"
  );

const calendarTitle =
  document.getElementById(
    "calendarTitle"
  );

const holidayCalendar =
  document.getElementById(
    "holidayCalendar"
  );

const holidayMessage =
  document.getElementById(
    "holidayMessage"
  );


/* =========================================
   使用中データ
========================================= */

let calendarData = {};

let loadedHolidayRecords = [];


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
    loginUser.adminScope === "none"
  ) {
    alert(
      "休日設定を開く権限がありません"
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

function showMessage(message) {
  holidayMessage.textContent =
    message;
}


function clearMessage() {
  holidayMessage.textContent =
    "";
}


function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}


function padNumber(value) {
  return String(value).padStart(
    2,
    "0"
  );
}


function formatDateKey(date) {
  return (
    `${date.getFullYear()}-` +
    `${padNumber(
      date.getMonth() + 1
    )}-` +
    `${padNumber(
      date.getDate()
    )}`
  );
}


function createLocalDate(
  year,
  month,
  day
) {
  return new Date(
    year,
    month - 1,
    day,
    12,
    0,
    0
  );
}


function addDays(
  originalDate,
  numberOfDays
) {
  const date =
    new Date(originalDate);

  date.setDate(
    date.getDate() +
    numberOfDays
  );

  return date;
}


function getDaysInMonth(
  year,
  month
) {
  return new Date(
    year,
    month,
    0
  ).getDate();
}


/* =========================================
   年度・月
========================================= */

function createFiscalYearOptions() {
  const today =
    new Date();

  const currentYear =
    today.getFullYear();

  const currentMonth =
    today.getMonth() + 1;

  const currentFiscalYear =
    currentMonth >= 4
      ? currentYear
      : currentYear - 1;

  fiscalYearSelect.innerHTML =
    "";

  for (
    let year =
      currentFiscalYear - 2;

    year <=
      currentFiscalYear + 3;

    year++
  ) {
    const option =
      document.createElement(
        "option"
      );

    option.value =
      String(year);

    option.textContent =
      `${year}年度`;

    fiscalYearSelect.appendChild(
      option
    );
  }

  fiscalYearSelect.value =
    String(currentFiscalYear);

  monthSelect.value =
    String(currentMonth);
}


function getSelectedCalendarYear() {
  const fiscalYear =
    Number(
      fiscalYearSelect.value
    );

  const month =
    Number(
      monthSelect.value
    );

  if (month >= 4) {
    return fiscalYear;
  }

  return fiscalYear + 1;
}


function getSelectedMonth() {
  return Number(
    monthSelect.value
  );
}


/* =========================================
   祝日取得
========================================= */

function getPublicHolidays(
  startDate,
  endDate
) {
  const publicHolidayMap =
    {};

  if (
    typeof holiday_jp ===
    "undefined"
  ) {
    console.error(
      "holiday_jpが読み込まれていません"
    );

    return publicHolidayMap;
  }

  const publicHolidays =
    holiday_jp.between(
      startDate,
      endDate
    );

  publicHolidays.forEach(
    holiday => {
      const holidayDate =
        holiday.date instanceof Date
          ? holiday.date
          : new Date(
              holiday.date
            );

      const dateKey =
        formatDateKey(
          holidayDate
        );

      publicHolidayMap[dateKey] =
        holiday.name || "祝日";
    }
  );

  return publicHolidayMap;
}


/* =========================================
   カレンダー範囲
========================================= */

function getCalendarRange(
  year,
  month
) {
  const firstDate =
    createLocalDate(
      year,
      month,
      1
    );

  const lastDate =
    createLocalDate(
      year,
      month,
      getDaysInMonth(
        year,
        month
      )
    );

  const calendarStart =
    addDays(
      firstDate,
      -firstDate.getDay()
    );

  const calendarEnd =
    addDays(
      lastDate,
      6 - lastDate.getDay()
    );

  return {
    firstDate,
    lastDate,
    calendarStart,
    calendarEnd
  };
}


/* =========================================
   自動設定作成
========================================= */

function createDefaultCalendarData() {
  const year =
    getSelectedCalendarYear();

  const month =
    getSelectedMonth();

  const {
    calendarStart,
    calendarEnd
  } =
    getCalendarRange(
      year,
      month
    );

  const publicHolidayMap =
    getPublicHolidays(
      calendarStart,
      calendarEnd
    );

  const newCalendarData =
    {};

  const numberOfDays =
    getDaysInMonth(
      year,
      month
    );

  /*
   * 最初に通常日・土日休日・祝日を設定
   */
  for (
    let day = 1;
    day <= numberOfDays;
    day++
  ) {
    const date =
      createLocalDate(
        year,
        month,
        day
      );

    const dateKey =
      formatDateKey(date);

    const weekday =
      date.getDay();

    let dayType =
       "出勤";

    let note =
      null;

    if (
      weekday === 0 ||
      weekday === 6
    ) {
      dayType =
        "休日";
    }

    if (
      publicHolidayMap[dateKey]
    ) {
      dayType =
        "祝日";

      note =
        publicHolidayMap[
          dateKey
        ];
    }

    newCalendarData[dateKey] = {
      date:
        dateKey,

      day_type:
        dayType,

      note
    };
  }

  /*
   * 日曜～土曜の同じ週に祝日があれば、
   * その週の土曜日を出勤にする
   */
  let weekStart =
    new Date(calendarStart);

  while (
    weekStart <= calendarEnd
  ) {
    const weekDates =
      [];

    for (
      let index = 0;
      index < 7;
      index++
    ) {
      weekDates.push(
        addDays(
          weekStart,
          index
        )
      );
    }

    const hasPublicHoliday =
      weekDates.some(date => {
        const dateKey =
          formatDateKey(date);

        return Boolean(
          publicHolidayMap[
            dateKey
          ]
        );
      });

    const saturday =
      weekDates[6];

    const saturdayKey =
      formatDateKey(
        saturday
      );

    const saturdayIsDisplayedMonth =
      saturday.getFullYear() ===
        year &&
      saturday.getMonth() + 1 ===
        month;

    const saturdayIsPublicHoliday =
      Boolean(
        publicHolidayMap[
          saturdayKey
        ]
      );

    if (
      hasPublicHoliday &&
      saturdayIsDisplayedMonth &&
      !saturdayIsPublicHoliday
    ) {
      newCalendarData[
        saturdayKey
      ] = {
        date:
          saturdayKey,

        day_type:
          "出勤",

        note:
          "同じ週に祝日があるため出勤"
      };
    }

    weekStart =
      addDays(
        weekStart,
        7
      );
  }

  calendarData =
    newCalendarData;
}


/* =========================================
   Supabaseから保存済みデータ取得
========================================= */

async function loadSavedHolidays() {
  const year =
    getSelectedCalendarYear();

  const month =
    getSelectedMonth();

  const startDate =
    `${year}-${padNumber(month)}-01`;

  let nextYear =
    year;

  let nextMonth =
    month + 1;

  if (nextMonth === 13) {
    nextYear =
      year + 1;

    nextMonth =
      1;
  }

  const endDate =
    `${nextYear}-${padNumber(
      nextMonth
    )}-01`;

  const url =
    `${SUPABASE_URL}/rest/v1/holidays` +
    `?select=*` +
    `&date=gte.${startDate}` +
    `&date=lt.${endDate}` +
    `&order=date.asc`;

  const response =
    await portalFetch(url);

  if (!response.ok) {
    const errorText =
      await response.text();

    console.error(errorText);

    throw new Error(
      "保存済みの休日情報を読み込めませんでした"
    );
  }

  loadedHolidayRecords =
    await response.json();

  return loadedHolidayRecords;
}


/* =========================================
   保存済みデータを反映
========================================= */

function applySavedHolidays() {
  loadedHolidayRecords.forEach(
    holiday => {
      calendarData[
        holiday.date
      ] = {
        id:
          holiday.id,

        date:
          holiday.date,

        day_type:
          holiday.day_type,

        note:
          holiday.note || null
      };
    }
  );
}


/* =========================================
   月カレンダー読み込み
========================================= */

async function loadCalendar() {
  clearMessage();

  holidayCalendar.innerHTML =
    `
      <p class="schedule-empty-message">
        カレンダーを読み込み中...
      </p>
    `;

  try {
    createDefaultCalendarData();

    await loadSavedHolidays();

    applySavedHolidays();

    renderCalendar();

  } catch (error) {
    console.error(error);

    holidayCalendar.innerHTML =
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
   表示用クラス
========================================= */

function getDayTypeClass(
  dayType
) {
  if (dayType === "休日") {
    return "holiday-day-holiday";
  }

  if (dayType === "祝日") {
    return "holiday-day-public";
  }

  if (dayType === "出勤") {
    return "holiday-day-work";
  }

  return "holiday-day-normal";
}


/* =========================================
   カレンダー表示
========================================= */

function renderCalendar() {
  const year =
    getSelectedCalendarYear();

  const month =
    getSelectedMonth();

  const {
    firstDate
  } =
    getCalendarRange(
      year,
      month
    );

  calendarTitle.textContent =
    `${year}年${month}月`;

  holidayCalendar.innerHTML =
    "";

  const weekdayRow =
    document.createElement(
      "div"
    );

  weekdayRow.className =
    "holiday-calendar-weekdays";

  const weekdayNames = [
    "日",
    "月",
    "火",
    "水",
    "木",
    "金",
    "土"
  ];

  weekdayNames.forEach(
    weekdayName => {
      const weekdayCell =
        document.createElement(
          "div"
        );

      weekdayCell.className =
        "holiday-calendar-weekday";

      weekdayCell.textContent =
        weekdayName;

      weekdayRow.appendChild(
        weekdayCell
      );
    }
  );

  holidayCalendar.appendChild(
    weekdayRow
  );

  const calendarGrid =
    document.createElement(
      "div"
    );

  calendarGrid.className =
    "holiday-calendar-grid";

  const emptyCellCount =
    firstDate.getDay();

  for (
    let index = 0;
    index < emptyCellCount;
    index++
  ) {
    const emptyCell =
      document.createElement(
        "div"
      );

    emptyCell.className =
      "holiday-calendar-empty";

    calendarGrid.appendChild(
      emptyCell
    );
  }

  const numberOfDays =
    getDaysInMonth(
      year,
      month
    );

  for (
    let day = 1;
    day <= numberOfDays;
    day++
  ) {
    const date =
      createLocalDate(
        year,
        month,
        day
      );

    const dateKey =
      formatDateKey(date);

    const dayData =
      calendarData[dateKey] || {
        date:
          dateKey,

        day_type:
          "有給奨励日",

        note:
          null
      };

    const dayButton =
      document.createElement(
        "button"
      );

    dayButton.type =
      "button";

    dayButton.className =
      `holiday-calendar-day ` +
      `${getDayTypeClass(
        dayData.day_type
      )}`;

    dayButton.innerHTML =
      `
        <span class="holiday-calendar-date">
          ${day}
        </span>

        <span class="holiday-calendar-status">
          ${escapeHtml(
            dayData.day_type
          )}
        </span>

        ${
          dayData.note
            ? `
              <span class="holiday-calendar-note">
                ${escapeHtml(
                  dayData.note
                )}
              </span>
            `
            : ""
        }
      `;

    dayButton.addEventListener(
      "click",
      () => {
        changeDayType(
          dateKey
        );
      }
    );

    calendarGrid.appendChild(
      dayButton
    );
  }

  holidayCalendar.appendChild(
    calendarGrid
  );
}


/* =========================================
   日付区分切り替え
========================================= */

function changeDayType(dateKey) {
  const currentData =
    calendarData[dateKey] || {
      date:
        dateKey,

      day_type:
        "出勤",

      note:
        null
    };

  const typeOrder = [
  "出勤",
  "休日",
  "祝日",
  "有給奨励日"
];

  const currentIndex =
    typeOrder.indexOf(
      currentData.day_type
    );

  const nextIndex =
    currentIndex >=
      typeOrder.length - 1
        ? 0
        : currentIndex + 1;

  const nextType =
    typeOrder[nextIndex];

  calendarData[dateKey] = {
    ...currentData,

    day_type:
      nextType,

    note:
      nextType === "出勤"
        ? null
        : currentData.note
  };

  renderCalendar();
}


/* =========================================
   自動設定ボタン
========================================= */

function resetToDefaultCalendar() {
  const confirmed =
    window.confirm(
      "この月を自動設定に戻しますか？\n" +
      "画面上の手動変更は元に戻ります。"
    );

  if (!confirmed) {
    return;
  }

  createDefaultCalendarData();

  renderCalendar();

  showMessage(
    "土日・祝日・土曜出勤の自動設定を作成しました。保存するまではデータベースに反映されません。"
  );
}


/* =========================================
   保存対象データ
========================================= */

function createSaveRecords() {
  return Object.values(
    calendarData
  ).map(record => {
    return {
      date:
        record.date,

      day_type:
        record.day_type,

      note:
        record.note || null
    };
  });
}


/* =========================================
   表示月の既存データ削除
========================================= */

async function deleteCurrentMonthRecords() {
  const year =
    getSelectedCalendarYear();

  const month =
    getSelectedMonth();

  const startDate =
    `${year}-${padNumber(month)}-01`;

  let nextYear =
    year;

  let nextMonth =
    month + 1;

  if (nextMonth === 13) {
    nextYear =
      year + 1;

    nextMonth =
      1;
  }

  const endDate =
    `${nextYear}-${padNumber(
      nextMonth
    )}-01`;

  const url =
    `${SUPABASE_URL}/rest/v1/holidays` +
    `?date=gte.${startDate}` +
    `&date=lt.${endDate}`;

  const response =
    await portalFetch(
      url,
      {
        method:
          "DELETE",

        headers: {
          Prefer:
            "return=minimal"
        }
      }
    );

  if (!response.ok) {
    const errorText =
      await response.text();

    console.error(errorText);

    throw new Error(
      "古い休日情報を整理できませんでした"
    );
  }
}


/* =========================================
   月データ保存
========================================= */

async function saveCalendar() {
  clearMessage();

  const year =
    getSelectedCalendarYear();

  const month =
    getSelectedMonth();

  const confirmed =
    window.confirm(
      `${year}年${month}月の休日設定を保存しますか？`
    );

  if (!confirmed) {
    return;
  }

  saveCalendarButton.disabled =
    true;

  saveCalendarButton.textContent =
    "保存中...";

  try {
    const saveRecords =
      createSaveRecords();

    await deleteCurrentMonthRecords();

    if (saveRecords.length > 0) {
      const url =
        `${SUPABASE_URL}/rest/v1/holidays`;

      const response =
        await portalFetch(
          url,
          {
            method:
              "POST",

            headers: {
              "Content-Type":
                "application/json",

              Prefer:
                "return=minimal"
            },

            body:
              JSON.stringify(
                saveRecords
              )
          }
        );

      if (!response.ok) {
        const errorText =
          await response.text();

        console.error(errorText);

        throw new Error(
          "休日設定を保存できませんでした"
        );
      }
    }

    await loadCalendar();

    showMessage(
      `${year}年${month}月の休日設定を保存しました。`
    );

  } catch (error) {
    console.error(error);

    showMessage(
      error.message
    );

  } finally {
    saveCalendarButton.disabled =
      false;

    saveCalendarButton.textContent =
      "この月を保存";
  }
}


/* =========================================
   前月・翌月
========================================= */

function moveMonth(direction) {
  let fiscalYear =
    Number(
      fiscalYearSelect.value
    );

  let month =
    getSelectedMonth();

  month += direction;

  if (month === 13) {
    month =
      1;
  }

  if (month === 0) {
    month =
      12;
  }

  /*
   * 年度をまたぐ場合
   */
  if (
    direction === 1 &&
    getSelectedMonth() === 3
  ) {
    fiscalYear +=
      1;
  }

  if (
    direction === -1 &&
    getSelectedMonth() === 4
  ) {
    fiscalYear -=
      1;
  }

  fiscalYearSelect.value =
    String(fiscalYear);

  monthSelect.value =
    String(month);

  loadCalendar();
}


/* =========================================
   イベント
========================================= */

fiscalYearSelect.addEventListener(
  "change",
  loadCalendar
);


monthSelect.addEventListener(
  "change",
  loadCalendar
);


createDefaultCalendarButton.addEventListener(
  "click",
  resetToDefaultCalendar
);


saveCalendarButton.addEventListener(
  "click",
  saveCalendar
);


previousMonthButton.addEventListener(
  "click",
  () => {
    moveMonth(-1);
  }
);


nextMonthButton.addEventListener(
  "click",
  () => {
    moveMonth(1);
  }
);


/* =========================================
   初期表示
========================================= */

async function initializeHolidayCalendar() {
  if (!checkAdminAccess()) {
    return;
  }

  createFiscalYearOptions();

  await loadCalendar();
}


initializeHolidayCalendar();