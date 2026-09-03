/* =========================================
   Supabase接続設定
========================================= */

const SUPABASE_URL =
  "https://fgmvmbjnoyagnpygcbky.supabase.co";


/* =========================================
   HTML要素
========================================= */

const rows =
  document.getElementById("rows");

const template =
  document.getElementById("dayTemplate");

const department =
  document.getElementById("department");

const employee =
  document.getElementById("employee");

const month =
  document.getElementById("month");

const summary =
  document.getElementById("summary");

const saveButton =
  document.getElementById("saveAttendance");

const submitButton =
  document.getElementById("submitAttendance");


/* =========================================
   読み込んだデータ
========================================= */

let employees = [];
let sites = [];
let holidays = {};

/*
  現在表示している出勤簿の状態

  draft     = 一時保存・編集可能
  submitted = 提出済・編集不可
  locked    = 締切済・完全編集不可
*/

let currentStatus = "draft";
let applicationManagedDates = new Set();
/* =========================================
   締め日設定
========================================= */

const CLOSING_DAY = 20;

/* =========================================
   時刻・曜日
========================================= */

const weeks = [
  "日",
  "月",
  "火",
  "水",
  "木",
  "金",   
  "土"
];


/* =========================================
   社員マスタ読込
========================================= */

async function loadEmployees() {
  const url =
    `${SUPABASE_URL}/rest/v1/employees` +
    `?select=id,department,name,active` +
    `&order=department.asc,id.asc`;

  const response =
    await portalFetch(url);

  if (!response.ok) {
    const errorText =
      await response.text();

    console.error(errorText);

    throw new Error(
      "社員マスタの読込に失敗しました"
    );
  }

  employees =
    await response.json();

  employees =
    employees.filter(
      item =>
        item.active !== false
    );

  makeDepartmentOptions();
}


/* =========================================
   現場マスタ読込
========================================= */

async function loadSites() {
  const url =
    `${SUPABASE_URL}/rest/v1/sites` +
    `?select=` +
    `id,display_order,display_name,input_code,` +
    `construction_no,client_code,client_name,` +
    `official_name,visible,site_type` +
    `&visible=eq.true` +
    `&order=display_order.asc`;

  const response =
    await portalFetch(url);

  if (!response.ok) {
    const errorText =
      await response.text();

    console.error(errorText);

    throw new Error(
      "現場マスタの読込に失敗しました"
    );
  }

  sites =
    await response.json();
}


/* =========================================
   休日カレンダー読込
========================================= */

async function loadHolidays() {
  const url =
    `${SUPABASE_URL}/rest/v1/holidays` +
    `?select=date,day_type,note` +
    `&order=date.asc`;

  const response =
    await portalFetch(url);

  if (!response.ok) {
    const errorText =
      await response.text();

    console.error(errorText);

    throw new Error(
      "休日カレンダーの読込に失敗しました"
    );
  }

  const data =
    await response.json();

  holidays = {};

  data.forEach(item => {
    holidays[item.date] =
      item;
  });
}


/* =========================================
   部プルダウン作成
========================================= */

function makeDepartmentOptions() {
  department.innerHTML =
    '<option value="">' +
    '部を選択してください' +
    '</option>';

  const departments = [
    ...new Set(
      employees
        .map(item => item.department)
        .filter(Boolean)
    )
  ];

  departments.forEach(departmentName => {
    const option =
      document.createElement("option");

    option.value = departmentName;
    option.textContent = departmentName;

    department.appendChild(option);
  });

  employee.innerHTML =
    '<option value="">' +
    '先に部を選択してください' +
    '</option>';

  employee.disabled = true;
}


/* =========================================
   氏名プルダウン作成
========================================= */

function makeEmployeeOptions(
  selectedDepartment
) {
  employee.innerHTML = "";

  if (!selectedDepartment) {
    employee.innerHTML =
      '<option value="">' +
      '先に部を選択してください' +
      '</option>';

    employee.disabled = true;

    return;
  }

  const filteredEmployees =
    employees.filter(
      item =>
        item.department ===
        selectedDepartment
    );

  employee.innerHTML =
    '<option value="">' +
    '氏名を選択してください' +
    '</option>';

  filteredEmployees.forEach(item => {
    const option =
      document.createElement("option");

    option.value =
      String(item.id);

    option.textContent =
      item.name;

    option.dataset.name =
      item.name;

    employee.appendChild(option);
  });

  employee.disabled = false;
}


/* =========================================
   選択中の社員名
========================================= */

function selectedEmployeeName() {
  const selectedOption =
    employee.options[
      employee.selectedIndex
    ];

  if (
    !selectedOption ||
    !employee.value
  ) {
    return "";
  }

  return (
    selectedOption.dataset.name ||
    selectedOption.textContent ||
    ""
  );
}


/* =========================================
   現在月
========================================= */

function currentMonth() {
  const today =
    new Date();

  let year =
    today.getFullYear();

  let monthValue =
    today.getMonth() + 1;

  /*
    20日締めのため、
    21日以降は翌月分を表示する
  */
  if (
    today.getDate() >
    CLOSING_DAY
  ) {
    monthValue += 1;

    if (monthValue === 13) {
      monthValue = 1;
      year += 1;
    }
  }

  const formattedMonth =
    String(monthValue).padStart(
      2,
      "0"
    );

  return (
    `${year}-` +
    `${formattedMonth}`
  );
}


/* =========================================
   月の日数
========================================= */
/* =========================================
   日付をYYYY-MM-DD形式に変換
========================================= */

function formatDateValue(date) {
  const year =
    date.getFullYear();

  const monthValue =
    String(date.getMonth() + 1)
      .padStart(2, "0");

  const dayValue =
    String(date.getDate())
      .padStart(2, "0");

  return `${year}-${monthValue}-${dayValue}`;
}


/* =========================================
   締め期間を取得
   例：2026-07
   → 2026-06-21 ～ 2026-07-20
========================================= */

function getAttendancePeriod(yearMonth) {
  const [
    year,
    monthValue
  ] =
    yearMonth
      .split("-")
      .map(Number);

  /*
    開始日：
    対象月の前月21日
  */

  const startDate =
    new Date(
      year,
      monthValue - 2,
      CLOSING_DAY + 1
    );

  /*
    終了日：
    対象月の20日
  */

  const endDate =
    new Date(
      year,
      monthValue - 1,
      CLOSING_DAY
    );

  const period = [];

  const currentDate =
    new Date(startDate);

  while (currentDate <= endDate) {
    period.push({
      date:
        formatDateValue(currentDate),

      day:
        currentDate.getDate(),

      month:
        currentDate.getMonth() + 1,

      weekNo:
        currentDate.getDay(),

      weekText:
        weeks[currentDate.getDay()]
    });

    currentDate.setDate(
      currentDate.getDate() + 1
    );
  }

  return period;
}


/* =========================================
   Supabase検索用の締め期間
========================================= */

function getAttendanceRange(yearMonth) {
  const period =
    getAttendancePeriod(yearMonth);

  const firstDay =
    period[0].date;

  const lastDateText =
    period[period.length - 1].date;

  const nextDate =
    new Date(
      `${lastDateText}T00:00:00`
    );

  nextDate.setDate(
    nextDate.getDate() + 1
  );

  return {
    firstDay:
      firstDay,

    nextFirstDay:
      formatDateValue(nextDate)
  };
}
function daysInMonth(yearMonth) {
  const [
    year,
    monthValue
  ] =
    yearMonth
      .split("-")
      .map(Number);

  return new Date(
    year,
    monthValue,
    0
  ).getDate();
}


/* =========================================
   翌月1日
========================================= */

function nextMonthFirstDay(yearMonth) {
  const [
    year,
    monthValue
  ] =
    yearMonth
      .split("-")
      .map(Number);

  const nextDate =
    new Date(
      year,
      monthValue,
      1
    );

  const nextYear =
    nextDate.getFullYear();

  const nextMonth =
    String(
      nextDate.getMonth() + 1
    ).padStart(
      2,
      "0"
    );

  return `${nextYear}-${nextMonth}-01`;
}


/* =========================================
   曜日情報
========================================= */

function dateInfo(
  yearMonth,
  day
) {
  const [
    year,
    monthValue
  ] =
    yearMonth
      .split("-")
      .map(Number);

  const date =
    new Date(
      year,
      monthValue - 1,
      day
    );

  return {
    weekNo: date.getDay(),
    weekText:
      weeks[date.getDay()]
  };
}


/* =========================================
   一般現場プルダウン作成
========================================= */

function setGeneralSiteOptions(
  selectElement
) {
  selectElement.innerHTML =
    '<option value="">' +
    '現場を選択してください' +
    '</option>';

  const generalSites =
    sites.filter(
      item =>
        item.site_type === "一般"
    );

  generalSites.forEach(site => {
    const option =
      document.createElement("option");

    option.value =
      String(site.id);

    option.textContent =
      site.display_name;

    option.dataset.displayName =
      site.display_name || "";

    option.dataset.inputCode =
      site.input_code || "";

    selectElement.appendChild(option);
  });
}


/* =========================================
   現場検索用文字列
========================================= */

function siteSearchText(site) {
  return [
    site.display_name,
    site.input_code,
    site.client_name,
    site.official_name
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}


/* =========================================
   雑工事の現場IDを探す
========================================= */

function findMiscSite(
  company,
  workDepartment
) {
  const miscSites =
    sites.filter(
      item =>
        item.site_type === "雑工事"
    );

  if (company === "三機") {
    return miscSites.find(site => {
      const text =
        siteSearchText(site);

      return (
        text.includes("三機") &&
        text.includes(
          workDepartment.toLowerCase()
        )
      );
    }) || null;
  }

  if (company === "自社") {
    return miscSites.find(site => {
      const text =
        siteSearchText(site);

      return (
        (
          text.includes("自社") &&
          text.includes(
            workDepartment.toLowerCase()
          )
        ) ||
        text.includes(
          `${workDepartment}雑`
            .toLowerCase()
        ) ||
        text.includes(
          `${workDepartment}雑工事`
            .toLowerCase()
        )
      );
    }) || null;
  }

  return miscSites.find(site => {
    const text =
      siteSearchText(site);

    return text.includes(
      company.toLowerCase()
    );
  }) || null;
}


/* =========================================
   会社勤務・一般・雑工事・休みの表示切替
========================================= */

function changeSiteType(row) {
  const siteType =
    row
      .querySelector(".site-type")
      .value;

  const companyWorkWrap =
    row.querySelector(
      ".company-work-wrap"
    );

  const companyWorkSelect =
    row.querySelector(
      ".company-work"
    );

  const generalSiteWrap =
    row.querySelector(
      ".general-site-wrap"
    );

  const miscCompanyWrap =
    row.querySelector(
      ".misc-company-wrap"
    );

  const miscDepartmentWrap =
    row.querySelector(
      ".misc-department-wrap"
    );

  const miscNameWrap =
    row.querySelector(
      ".misc-name-wrap"
    );

  const leaveTypeWrap =
    row.querySelector(
      ".leave-type-wrap"
    );

  const startSelect =
    row.querySelector(".start");

  const endSelect =
    row.querySelector(".end");

  const leaveTypeSelect =
    row.querySelector(
      ".leave-type"
    );

  /*
    いったん全部隠す
  */

  row.classList.remove("leave-day");

  companyWorkWrap
    .classList
    .add("hidden");

  generalSiteWrap
    .classList
    .add("hidden");

  miscCompanyWrap
    .classList
    .add("hidden");

  miscDepartmentWrap
    .classList
    .add("hidden");

  miscNameWrap
    .classList
    .add("hidden");

  leaveTypeWrap
    .classList
    .add("hidden");

  /*
    会社勤務
  */

  if (siteType === "会社勤務") {
    companyWorkWrap
      .classList
      .remove("hidden");

    if (!startSelect.value) {
      startSelect.value = "08:00";
    }

    if (!endSelect.value) {
      endSelect.value = "17:00";
    }

    leaveTypeSelect.value = "";

    startSelect.disabled = false;
    endSelect.disabled = false;

    return;
  }

  /*
    一般
  */

  if (siteType === "一般") {
    generalSiteWrap
      .classList
      .remove("hidden");

    companyWorkSelect.value = "";

    if (!startSelect.value) {
      startSelect.value = "08:00";
    }

    if (!endSelect.value) {
      endSelect.value = "17:00";
    }

    leaveTypeSelect.value = "";

    startSelect.disabled = false;
    endSelect.disabled = false;

    return;
  }

  /*
    雑工事
  */

  if (siteType === "雑工事") {
    miscCompanyWrap
      .classList
      .remove("hidden");

    companyWorkSelect.value = "";

    changeMiscCompany(row);

    if (!startSelect.value) {
      startSelect.value = "08:00";
    }

    if (!endSelect.value) {
      endSelect.value = "17:00";
    }

    leaveTypeSelect.value = "";

    startSelect.disabled = false;
    endSelect.disabled = false;

    return;
  }

  /*
  有給奨励日
*/

if (siteType === "有給奨励日") {
  row.classList.add("leave-day");

  companyWorkSelect.value = "";
  leaveTypeSelect.value = "";

  startSelect.value = "";
  endSelect.value = "";

  startSelect.disabled = true;
  endSelect.disabled = true;

  return;
}

  /*
    休み
  */

  if (siteType === "休み") {
    row.classList.add("leave-day");

    companyWorkSelect.value = "";

    leaveTypeWrap
      .classList
      .remove("hidden");

    startSelect.value = "";
    endSelect.value = "";

    startSelect.disabled = true;
    endSelect.disabled = true;

    return;
  }

  /*
    未選択
  */

  companyWorkSelect.value = "";
  leaveTypeSelect.value = "";

  startSelect.value = "";
  endSelect.value = "";

  startSelect.disabled = false;
  endSelect.disabled = false;
}

/* =========================================
   雑工事区分の表示切替
========================================= */

function changeMiscCompany(row) {
  const company =
    row
      .querySelector(".misc-company")
      .value;

  const miscDepartmentWrap =
    row.querySelector(
      ".misc-department-wrap"
    );

  const miscNameWrap =
    row.querySelector(
      ".misc-name-wrap"
    );

  miscDepartmentWrap
    .classList
    .add("hidden");

  miscNameWrap
    .classList
    .add("hidden");

  if (!company) {
    return;
  }

  if (
    company === "三機" ||
    company === "自社"
  ) {
    miscDepartmentWrap
      .classList
      .remove("hidden");
  }

  miscNameWrap
    .classList
    .remove("hidden");
}


function getRowSiteData(row) {
  const siteType =
    row
      .querySelector(".site-type")
      .value;

  /*
    会社勤務
  */

  if (siteType === "会社勤務") {
    const companyWork =
      row
        .querySelector(".company-work")
        .value;

    return {
      siteType: "会社勤務",
      siteId: "",
      siteDisplayName: companyWork,
      siteInputCode: "",
      companyWork: companyWork,
      miscCompany: "",
      miscDepartment: "",
      miscName: ""
    };
  }

  /*
    一般
  */

  if (siteType === "一般") {
    const selectElement =
      row.querySelector(
        ".general-site"
      );

    const selectedOption =
      selectElement.options[
        selectElement.selectedIndex
      ];

    return {
      siteType: "一般",

      siteId:
        selectElement.value || "",

      siteDisplayName:
        selectedOption
          ?.dataset
          ?.displayName || "",

      siteInputCode:
        selectedOption
          ?.dataset
          ?.inputCode || "",

      companyWork: "",
      miscCompany: "",
      miscDepartment: "",
      miscName: ""
    };
  }

  /*
    雑工事
  */

  if (siteType === "雑工事") {
    const company =
      row
        .querySelector(".misc-company")
        .value;

    const workDepartment =
      row
        .querySelector(".misc-department")
        .value;

    const miscName =
      row
        .querySelector(".misc-name")
        .value
        .trim();

    const matchedSite =
      findMiscSite(
        company,
        workDepartment
      );

    return {
      siteType: "雑工事",

      siteId:
        matchedSite
          ? String(matchedSite.id)
          : "",

      siteDisplayName:
        matchedSite
          ? matchedSite.display_name
          : company,

      siteInputCode:
        matchedSite
          ? matchedSite.input_code || ""
          : "",

      companyWork: "",

      miscCompany:
        company,

      miscDepartment:
        workDepartment,

      miscName:
        miscName
    };
  }

  /*
    休み
  */

  if (siteType === "休み") {
    const leaveType =
      row
        .querySelector(".leave-type")
        .value;

    return {
      siteType: "休み",
      siteId: "",
      siteDisplayName: leaveType,
      siteInputCode: "",
      companyWork: "",
      miscCompany: "",
      miscDepartment: "",
      miscName: ""
    };
  }

  /*
    未選択
  */

  return {
    siteType: "",
    siteId: "",
    siteDisplayName: "",
    siteInputCode: "",
    companyWork: "",
    miscCompany: "",
    miscDepartment: "",
    miscName: ""
  };
}


/* =========================================
   日別入力欄作成
========================================= */

function renderRows() {
  rows.innerHTML = "";

  const yearMonth =
    month.value ||
    currentMonth();

  /*
    20日締めの期間を取得する。

    例：
    対象月 2026-07
    2026-06-21 ～ 2026-07-20
  */

  const attendancePeriod =
    getAttendancePeriod(yearMonth);

  attendancePeriod.forEach(
    periodDay => {

      const node =
        template
          .content
          .cloneNode(true);

      const row =
        node.querySelector(
          ".day-row"
        );

      const holiday =
        holidays[periodDay.date];

      /*
        保存・読込に使う日付
      */

      row.dataset.day =
        String(periodDay.day);

      row.dataset.date =
        periodDay.date;

      /*
        日曜日は赤文字
      */

      if (periodDay.weekNo === 0) {
        row.classList.add(
          "sunday"
        );
      }

      if (periodDay.weekNo === 6) {
        row.classList.add(
          "attendance-saturday"
        );
      }

      /*
        休日・祝日は休日表示
      */

      if (
  holiday &&
  (
    holiday.day_type === "休日" ||
    holiday.day_type === "祝日" ||
    holiday.day_type === "有給奨励日"
  )
) {
        row.classList.add(
          "company-holiday"
        );
      }

      /*
        日付表示

        月をまたぐので、
        6/21、7/1のように月も表示する。
      */

      row
        .querySelector(".day")
        .textContent =
        `${periodDay.month}/${periodDay.day}`;

      row
        .querySelector(".week")
        .textContent =
        `(${periodDay.weekText})`;

      

      /*
        一般現場プルダウン
      */

      setGeneralSiteOptions(
        row.querySelector(
          ".general-site"
        )
      );

       /*
  /*
  会社カレンダーを出勤簿へ自動反映する

  休日・祝日
  → 休み／休日

  有給奨励日
  → 休み／有給
*/

if (holiday) {
  const siteTypeSelect =
    row.querySelector(".site-type");

  const leaveTypeSelect =
    row.querySelector(".leave-type");

  if (
    holiday.day_type === "休日" ||
    holiday.day_type === "祝日"
  ) {
    siteTypeSelect.value =
      "休み";

    leaveTypeSelect.value =
      "休日";

    changeSiteType(row);
  }

  if (
  holiday.day_type ===
  "有給奨励日"
) {
  siteTypeSelect.value =
    "有給奨励日";

  leaveTypeSelect.value =
    "";

  changeSiteType(row);
}
}

      /*
        一般・雑工事の切替
      */

      row
        .querySelector(".site-type")
        .addEventListener(
          "change",
          () => {
            changeSiteType(row);
            updateSummary();
          }
        );

      /*
        雑工事区分の切替
      */

      row
        .querySelector(".misc-company")
        .addEventListener(
          "change",
          () => {
            changeMiscCompany(row);
            updateSummary();
          }
        );

            /*
        開始・終了時刻を30分単位へ補正
      */

      row
        .querySelectorAll(".start, .end")
        .forEach(timeInput => {
          timeInput.addEventListener(
            "change",
            () => {
              if (!timeInput.value) {
                return;
              }

              const [
                hour,
                minute
              ] = timeInput.value
                .split(":")
                .map(Number);

              const roundedMinute =
                minute < 15
                  ? 0
                  : minute < 45
                    ? 30
                    : 0;

              let roundedHour = hour;

              if (minute >= 45) {
                roundedHour =
                  (hour + 1) % 24;
              }

              timeInput.value =
                `${String(roundedHour).padStart(2, "0")}:` +
                `${String(roundedMinute).padStart(2, "0")}`;
            }
          );
        });  

      /*
        入力件数の更新
      */

      row
        .querySelectorAll(
          "select,input"
        )
        .forEach(element => {

          element.addEventListener(
            "change",
            updateSummary
          );

          element.addEventListener(
            "input",
            updateSummary
          );
        });

      rows.appendChild(node);
    }
  );

  applyStatusToScreen();
  updateSummary();
}


/* =========================================
   入力データ収集
========================================= */

function collectData() {
  const data = [];

  document
    .querySelectorAll(".day-row")
    .forEach(row => {
      const siteData =
        getRowSiteData(row);

      data.push({
        day:
          row.dataset.day,

        date:
          row.dataset.date,

        siteType:
          siteData.siteType,

        siteId:
          siteData.siteId,

        siteDisplayName:
          siteData.siteDisplayName,

        siteInputCode:
          siteData.siteInputCode,

        miscCompany:
          siteData.miscCompany,

        miscDepartment:
          siteData.miscDepartment,

        miscName:
          siteData.miscName,

          companyWork:
         siteData.companyWork,

         leaveType:
  row
    .querySelector(".leave-type")
    .value,

        start:
          row
            .querySelector(".start")
            .value,

        end:
          row
            .querySelector(".end")
            .value,

        note:
          row
            .querySelector(".note")
            .value
      });
    });

  return data;
}


/* =========================================
   attendance保存用データ作成
========================================= */

function makeAttendanceRecords(status) {
  const employeeId =
    Number(employee.value);

  return collectData()
    .filter(item => !applicationManagedDates.has(item.date))
    .map(item => {
    return {
      employee_id:
        employeeId,

      work_date:
        item.date,

      site_type:
  item.siteType ||
  (
    item.leaveType
      ? "休み"
      : ""
  ),
      site_id:
        item.siteId
          ? Number(item.siteId)
          : null,

      misc_company:
        item.miscCompany || "",

      misc_department:
        item.miscDepartment || "",
      
      company_work:
        item.companyWork || "",  

      misc_name:
        item.miscName || "",

      leave_type:
        item.leaveType || "",

      start_time:
        item.start || "",

      end_time:
        item.end || "",

      note:
        item.note || "",

      status:
        status
    };
  });
}

/* =========================================
   対象期間の既存データ削除
========================================= */

async function deleteExistingAttendance() {
  const range =
    getAttendanceRange(
      month.value
    );

  const url =
    `${SUPABASE_URL}/rest/v1/attendance` +
    `?employee_id=eq.${employee.value}` +
    `&work_date=gte.${range.firstDay}` +
    `&work_date=lt.${range.nextFirstDay}` +
    `&source_application_id=is.null`;

  const response =
    await portalFetch(
      url,
      {
        method: "DELETE",

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
      "既存データの削除に失敗しました"
    );
  }
}

async function updateApplicationManagedAttendanceStatus(status) {
  if (applicationManagedDates.size === 0) return;

  const range = getAttendanceRange(month.value);
  const url =
    `${SUPABASE_URL}/rest/v1/attendance` +
    `?employee_id=eq.${employee.value}` +
    `&work_date=gte.${range.firstDay}` +
    `&work_date=lt.${range.nextFirstDay}` +
    `&source_application_id=not.is.null`;
  const response = await portalFetch(url, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Prefer: "return=minimal"
    },
    body: JSON.stringify({ status })
  });

  if (!response.ok) {
    console.error(await response.text());
    throw new Error("申請反映済み日付の提出状態を更新できませんでした");
  }
}

/* =========================================
   Supabaseへ保存
========================================= */

async function saveAttendanceWithStatus(
  status,
  successMessage
) {
  if (!department.value) {
    alert(
      "部を選択してください"
    );

    return false;
  }

  if (department.value !== "工事部") {
    alert(
      "出勤簿は現在、工事部のみ提出できます"
    );

    return false;
  }

  if (!employee.value) {
    alert(
      "氏名を選択してください"
    );

    return false;
  }

  if (!month.value) {
    alert(
      "対象月を選択してください"
    );

    return false;
  }

  const invalidTimeRow =
    collectData().find(item => {

      const isInvalidTime = timeValue => {
        if (!timeValue) {
          return false;
        }

        const minute =
          timeValue.split(":")[1];

        return (
          minute !== "00" &&
          minute !== "30"
        );
      };

      return (
        isInvalidTime(item.start) ||
        isInvalidTime(item.end)
      );
    });

  if (invalidTimeRow) {
    alert(
      `${invalidTimeRow.date}の時刻は、` +
      `00分または30分で入力してください`
    );

    return false;
  }

  const records =
    makeAttendanceRecords(
      status
    );

  saveButton.disabled = true;
  submitButton.disabled = true;

  try {
    await deleteExistingAttendance();

    const url =
      `${SUPABASE_URL}/rest/v1/attendance`;

    const response =
      await portalFetch(
        url,
        {
          method: "POST",

          headers: {
            "Content-Type":
              "application/json",

            Prefer:
              "return=minimal"
          },

          body:
            JSON.stringify(
              records
            )
        }
      );

    if (!response.ok) {
      const errorText =
        await response.text();

      console.error(errorText);

      throw new Error(
        "出勤簿の保存に失敗しました"
      );
    }

    await updateApplicationManagedAttendanceStatus(status);

    currentStatus = status;

    applyStatusToScreen();

    alert(
      successMessage
    );

    return true;

  } catch (error) {
    console.error(error);

    alert(
      error.message
    );

    return false;

  } finally {
    saveButton.disabled = false;
    submitButton.disabled = false;

    applyStatusToScreen();
  }
}


/* =========================================
   一時保存
========================================= */

async function saveDraft() {
  if (
    currentStatus !== "draft"
  ) {
    return;
  }

  await saveAttendanceWithStatus(
    "draft",
    `${selectedEmployeeName()}さんの` +
    `${month.value}分を一時保存しました`
  );
}


/* =========================================
   提出・提出取消
========================================= */

async function toggleSubmit() {
  if (!employee.value) {
    alert(
      "氏名を選択してください"
    );

    return;
  }

  if (
    currentStatus === "locked"
  ) {
    alert(
      "この出勤簿は締切済みです"
    );

    return;
  }

  /*
    未提出の場合は提出する。
  */

  if (
    currentStatus === "draft"
  ) {

        /*
      未入力日のチェック
    */

    const missingDays =
      collectData().filter(
        item => !item.siteType
      );

    if (missingDays.length > 0) {
      const missingDateText =
        missingDays
          .map(item => {
            const date =
              new Date(
                `${item.date}T00:00:00`
              );

            return (
              `${date.getMonth() + 1}/` +
              `${date.getDate()}`
            );
          })
          .join("、");

      alert(
        "未入力の日があります。\n\n" +
        `${missingDateText}\n\n` +
        "すべての日を入力してから提出してください。"
      );

      return;
    }

        /*
      入力内容の不足チェック
    */

    const incompleteRow =
      collectData().find(item => {

        /*
          会社勤務
        */
        if (
          item.siteType === "会社勤務" &&
          !item.companyWork
        ) {
          return true;
        }

        /*
          一般
        */
        if (
          item.siteType === "一般" &&
          !item.siteId
        ) {
          return true;
        }

        /*
          雑工事
        */
        if (
          item.siteType === "雑工事"
        ) {
          if (!item.miscCompany) {
            return true;
          }

          if (
            (
              item.miscCompany === "三機" ||
              item.miscCompany === "自社"
            ) &&
            !item.miscDepartment
          ) {
            return true;
          }
        }

        /*
          休み
        */
        if (
          item.siteType === "休み" &&
          !item.leaveType
        ) {
          return true;
        }

        /*
          出勤日の開始・終了時刻
        */
        if (
          item.siteType === "会社勤務" ||
          item.siteType === "一般" ||
          item.siteType === "雑工事"
        ) {
          if (
            !item.start ||
            !item.end
          ) {
            return true;
          }
        }

        return false;
      });

    if (incompleteRow) {
      const date =
        new Date(
          `${incompleteRow.date}T00:00:00`
        );

      const displayDate =
        `${date.getMonth() + 1}/` +
        `${date.getDate()}`;

      alert(
        `${displayDate}の入力内容に不足があります。\n\n` +
        "勤務内容・現場・休暇区分・開始終了時刻などを確認してください。"
      );

      return;
    }

    const confirmed =
      window.confirm(
        `${selectedEmployeeName()}さんの` +
        `${month.value}分を提出しますか？\n\n` +
        `提出後は、提出取消をするまで編集できません。`
      );

    if (!confirmed) {
      return;
    }

    await saveAttendanceWithStatus(
      "submitted",
      "出勤簿を提出しました"
    );

    return;
  }

  /*
    提出済の場合は提出取消。
  */

  if (
    currentStatus === "submitted"
  ) {
    const confirmed =
      window.confirm(
        "提出を取り消しますか？\n\n" +
        "取消後は再び編集できます。"
      );

    if (!confirmed) {
      return;
    }

    await saveAttendanceWithStatus(
      "draft",
      "提出を取り消しました"
    );
  }
}

/* =========================================
   時刻をinput type="time"用に整える
========================================= */

function normalizeTimeValue(timeValue) {
  if (!timeValue) {
    return "";
  }

  const parts =
    String(timeValue).split(":");

  const hour =
    String(parts[0]).padStart(2, "0");

  const minute =
    String(parts[1] || "00").padStart(2, "0");

  return `${hour}:${minute}`;
}

/* =========================================
   1日分の保存データを画面へ反映
========================================= */

function applicationApprovalNote(item) {
  if (item?.source_application_id == null) return item?.note || "";
  if (item.leave_type === "有給") return "申請承認済み（有給）";
  if (item.leave_type === "代休") return "申請承認済み（代休）";
  return "申請承認済み";
}

function restoreAttendanceRow(
  row,
  item
) {
  if (!item) {
    return;
  }

  row
    .querySelector(".site-type")
    .value =
    item.site_type || "";

  changeSiteType(row);

/* 会社勤務 */
  if (
     item.site_type === "会社勤務"
  ) {
    row
    .querySelector(".company-work")
    .value =
    item.company_work || "";
}

  /* 一般 */
  if (
    item.site_type === "一般"
  ) {
    row
      .querySelector(".general-site")
      .value =
      item.site_id
        ? String(item.site_id)
        : "";
  }

  /* 雑工事 */
  if (
    item.site_type === "雑工事"
  ) {

    row
      .querySelector(".misc-company")
      .value =
      item.misc_company || "";

    changeMiscCompany(row);

    row
      .querySelector(".misc-department")
      .value =
      item.misc_department || "";

    row
      .querySelector(".misc-name")
      .value =
      item.misc_name || "";
  }

/* 有給奨励日 */
if (
  item.site_type ===
  "有給奨励日"
) {
  row
    .querySelector(".site-type")
    .value =
    "有給奨励日";

  changeSiteType(row);
}

  /* 休み */
  if (
    item.site_type === "休み"
  ) {
    row
      .querySelector(".leave-type")
      .value =
      item.leave_type || "";
  }
  

  /* 時間 */

if (
  item.site_type ===
  "有給奨励日"
) {
  row
    .querySelector(".start")
    .value =
    "";

  row
    .querySelector(".end")
    .value =
    "";

} else {
  row
    .querySelector(".start")
    .value =
    normalizeTimeValue(
      item.start_time
    );

  row
    .querySelector(".end")
    .value =
    normalizeTimeValue(
      item.end_time
    );
}

  /* 備考 */
  const noteInput = row.querySelector(".note");
  noteInput.value = applicationApprovalNote(item);
  noteInput.classList.toggle(
    "application-managed-note",
    item.source_application_id != null
  );
}

/* =========================================
   Supabaseから対象月を読込
========================================= */

async function loadAttendance() {
  currentStatus =
    "draft";

  if (
    !employee.value ||
    !month.value
  ) {
    applyStatusToScreen();
    updateSummary();

    return;
  }

  const range =
    getAttendanceRange(
      month.value
    );

  const url =
    `${SUPABASE_URL}/rest/v1/attendance` +
    `?select=*` +
    `&employee_id=eq.${employee.value}` +
    `&work_date=gte.${range.firstDay}` +
    `&work_date=lt.${range.nextFirstDay}` +
    `&order=work_date.asc`;

  const response =
    await portalFetch(url);

  if (!response.ok) {
    const errorText =
      await response.text();

    console.error(errorText);

    throw new Error(
      "出勤簿の読込に失敗しました"
    );
  }

  const attendanceData =
    await response.json();

  if (
    attendanceData.length > 0
  ) {
    currentStatus =
      attendanceData[0].status ||
      "draft";
  }

  const dataByDate = {};
  applicationManagedDates = new Set(
    attendanceData
      .filter(item => item.source_application_id != null)
      .map(item => item.work_date)
  );

  attendanceData.forEach(
    item => {
      dataByDate[
        item.work_date
      ] = item;
    }
  );

  document
    .querySelectorAll(
      ".day-row"
    )
    .forEach(row => {
      const item =
        dataByDate[
          row.dataset.date
        ];

      restoreAttendanceRow(
        row,
        item
      );
    });

  applyStatusToScreen();
  updateSummary();
}

/* =========================================
   提出状態を画面へ反映
========================================= */

function applyStatusToScreen() {
  const inputElements =
    document.querySelectorAll(
      ".day-row select, .day-row input"
    );

  /*
    一時保存中
  */

  if (
    currentStatus === "draft"
  ) {
    inputElements.forEach(element => {
      element.disabled = false;
    });
     /*
  区分が「休み」の日は、
  開始・終了を再び操作不可にする
*/

document
  .querySelectorAll(".day-row")
  .forEach(row => {
    const siteType =
      row.querySelector(".site-type").value;

    if (siteType === "休み") {
      row.querySelector(".start").disabled = true;
      row.querySelector(".end").disabled = true;
    }
  });
    document
      .querySelectorAll(".day-row")
      .forEach(row => {
        if (!applicationManagedDates.has(row.dataset.date)) return;
        row.querySelectorAll("select,input").forEach(element => {
          element.disabled = true;
        });
      });
    saveButton.disabled = false;
    saveButton.textContent = "一時保存";

    submitButton.disabled = false;
    submitButton.textContent = "提出";

    summary.textContent =
      `${getInputCount()}件入力`;

    return;
  }

  /*
    提出済
  */

  if (
    currentStatus === "submitted"
  ) {
    inputElements.forEach(element => {
      element.disabled = true;
    });

    saveButton.disabled = true;
    saveButton.textContent = "提出済";

    submitButton.disabled = false;
    submitButton.textContent = "提出取消";

    summary.textContent =
      `提出済・${getInputCount()}件入力`;

    return;
  }

  /*
    締切済
  */

  if (
    currentStatus === "locked"
  ) {
    inputElements.forEach(element => {
      element.disabled = true;
    });

    saveButton.disabled = true;
    saveButton.textContent = "締切済";

    submitButton.disabled = true;
    submitButton.textContent = "締切済";

    summary.textContent =
      `締切済・${getInputCount()}件入力`;
  }
}


/* =========================================
   入力件数取得
========================================= */

function getInputCount() {
  return collectData().filter(item => {
    return (
      item.siteType ||
      item.siteId ||
      item.miscCompany ||
      item.miscDepartment ||
      item.miscName ||
       item.leaveType ||
      item.start ||
      item.end ||
      item.note
    );
  }).length;
}


/* =========================================
   入力件数表示
========================================= */

function updateSummary() {
  if (
    currentStatus === "submitted" ||
    currentStatus === "locked"
  ) {
    applyStatusToScreen();

    return;
  }

  summary.textContent =
    `${getInputCount()}件入力`;
}


/* =========================================
   画面更新・クラウド読込
========================================= */

async function refreshAttendanceScreen() {
  currentStatus = "draft";
  applicationManagedDates = new Set();

  renderRows();

  if (!employee.value) {
    applyStatusToScreen();

    return;
  }

  try {
    await loadAttendance();

  } catch (error) {
    console.error(error);

    alert(error.message);
  }
}


/* =========================================
   イベント設定
========================================= */

month.value =
  currentMonth();


department.addEventListener(
  "change",
  () => {
    currentStatus = "draft";

    makeEmployeeOptions(
      department.value
    );

    renderRows();
  }
);


employee.addEventListener(
  "change",
  refreshAttendanceScreen
);


month.addEventListener(
  "change",
  refreshAttendanceScreen
);


document
  .getElementById("makeRows")
  .addEventListener(
    "click",
    refreshAttendanceScreen
  );


saveButton.addEventListener(
  "click",
  saveDraft
);


submitButton.addEventListener(
  "click",
  toggleSubmit
);


/* =========================================
   初期読込
========================================= */

Promise.all([
  loadEmployees(),
  loadSites(),
  loadHolidays()
])
  .then(async () => {
    /*
      ログイン情報を取得
    */

    const savedLoginUser =
      localStorage.getItem(
        "portalLoginUser"
      );

    /*
      ログイン情報がない場合は、
      ログイン画面へ戻す
    */

    if (!savedLoginUser) {
      window.location.href =
        "login.html";

      return;
    }

    let loginUser;

    try {
      loginUser =
        JSON.parse(savedLoginUser);

    } catch (error) {
      console.error(error);

      localStorage.removeItem(
        "portalLoginUser"
      );

      window.location.href =
        "login.html";

      return;
    }

    /*
      ログインした人の部を選択
    */

    department.value =
      loginUser.department || "";

    /*
      選んだ部に所属する社員一覧を作る
    */

    makeEmployeeOptions(
      department.value
    );

    /*
      ログインした本人を選択
    */

    employee.value =
      String(loginUser.id);

    /*
      ログインした本人で固定する
    */

     department.disabled = true;
     employee.disabled = true;
    /*
      日付欄を作り、
      本人の保存データを読み込む
    */

    renderRows();

    await loadAttendance();
  })
  .catch(error => {
    console.error(error);

    alert(error.message);
  });
