const MY_PAGE_SUPABASE_URL =
  "https://fgmvmbjnoyagnpygcbky.supabase.co";

const MY_PAGE_ATTENDANCE_CLOSING_DAY =
  20;


const attendanceSubmissionStatus =
  document.getElementById(
    "attendanceSubmissionStatus"
  );

const improvementSubmissionStatus =
  document.getElementById(
    "improvementSubmissionStatus"
  );

const nearMissSubmissionStatus =
  document.getElementById(
    "nearMissSubmissionStatus"
  );

const attendanceDeadlineNotice =
  document.getElementById(
    "attendanceDeadlineNotice"
  );

const improvementDeadlineNotice =
  document.getElementById(
    "improvementDeadlineNotice"
  );

const nearMissDeadlineNotice =
  document.getElementById(
    "nearMissDeadlineNotice"
  );


/* =========================================
   ログイン中社員取得
========================================= */

function getMyPageLoginUser() {
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
   日付をYYYY-MM-DD形式へ変換
========================================= */

function formatMyPageDateValue(date) {
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
   出勤簿の現在対象月
========================================= */

function getMyPageAttendanceMonth() {
  const today =
    new Date();

  let year =
    today.getFullYear();

  let month =
    today.getMonth() + 1;

  if (
    today.getDate() >
    MY_PAGE_ATTENDANCE_CLOSING_DAY
  ) {
    month += 1;

    if (month === 13) {
      month = 1;
      year += 1;
    }
  }

  return (
    `${year}-` +
    `${String(month).padStart(2, "0")}`
  );
}


/* =========================================
   出勤簿の締め期間
========================================= */

function getMyPageAttendanceRange(
  yearMonth
) {
  const [
    year,
    month
  ] =
    yearMonth
      .split("-")
      .map(Number);

  const firstDate =
    new Date(
      year,
      month - 2,
      MY_PAGE_ATTENDANCE_CLOSING_DAY + 1
    );

  const nextFirstDate =
    new Date(
      year,
      month - 1,
      MY_PAGE_ATTENDANCE_CLOSING_DAY + 1
    );

  return {
    firstDay:
      formatMyPageDateValue(firstDate),

    nextFirstDay:
      formatMyPageDateValue(nextFirstDate)
  };
}


/* =========================================
   対象月から提出期限を取得
========================================= */

function getMyPageSubmissionDeadline(
  targetMonth,
  deadlineDay
) {
  if (!targetMonth) {
    return null;
  }

  const [
    year,
    month
  ] =
    String(targetMonth)
      .slice(0, 7)
      .split("-")
      .map(Number);

  if (
    !year ||
    !month
  ) {
    return null;
  }

  return new Date(
    year,
    month - 1,
    deadlineDay
  );
}


function getMyPageDateOnly(date) {
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate()
  );
}


function createMyPageSubmissionResult(
  submitted,
  targetMonth,
  deadlineDay
) {
  const deadline =
    getMyPageSubmissionDeadline(
      targetMonth,
      deadlineDay
    );

  return {
    submitted,
    targetMonth,
    deadline:
      deadline
        ? formatMyPageDateValue(deadline)
        : null
  };
}


function isMyPageSubmissionOverdue(
  submissionResult
) {
  if (
    !submissionResult ||
    submissionResult.submitted !== false ||
    !submissionResult.deadline
  ) {
    return false;
  }

  const today =
    getMyPageDateOnly(
      new Date()
    );

  const deadline =
    new Date(
      `${submissionResult.deadline}T00:00:00`
    );

  return today > deadline;
}


/* =========================================
   出勤簿提出状況表示
========================================= */

function showAttendanceSubmissionStatus(
  submitted,
  targetMonth
) {
  attendanceSubmissionStatus
    .classList.remove(
      "is-submitted",
      "is-not-submitted"
    );

  if (submitted) {
    attendanceSubmissionStatus
      .textContent =
        "提出済み";

    attendanceSubmissionStatus
      .classList.add(
        "is-submitted"
      );

    updateSubmissionDeadlineNotice(
      attendanceDeadlineNotice,
      true,
      20,
      targetMonth
    );

    return;
  }

  attendanceSubmissionStatus
    .textContent =
      "未提出";

  attendanceSubmissionStatus
    .classList.add(
      "is-not-submitted"
    );

  updateSubmissionDeadlineNotice(
    attendanceDeadlineNotice,
    false,
    20,
    targetMonth
  );
}


/* =========================================
   月次提出状況表示
========================================= */

function showMonthlySubmissionStatus(
  statusElement,
  submitted,
  deadlineNotice,
  deadlineDay,
  targetMonth
) {
  statusElement.classList.remove(
    "is-submitted",
    "is-not-submitted"
  );

  if (submitted) {
    statusElement.textContent =
      "提出済み";

    statusElement.classList.add(
      "is-submitted"
    );

    updateSubmissionDeadlineNotice(
      deadlineNotice,
      true,
      deadlineDay,
      targetMonth
    );

    return;
  }

  statusElement.textContent =
    "未提出";

  statusElement.classList.add(
    "is-not-submitted"
  );

  updateSubmissionDeadlineNotice(
    deadlineNotice,
    false,
    deadlineDay,
    targetMonth
  );
}


/* =========================================
   提出期限注意表示
========================================= */

function updateSubmissionDeadlineNotice(
  noticeElement,
  submitted,
  deadlineDay,
  targetMonth
) {
  noticeElement.textContent = "";

  noticeElement.classList.add(
    "hidden"
  );

  noticeElement.classList.remove(
    "is-today"
  );

  if (submitted) {
    return;
  }

  const deadline =
    getMyPageSubmissionDeadline(
      targetMonth,
      deadlineDay
    );

  if (!deadline) {
    return;
  }

  const today =
    getMyPageDateOnly(
      new Date()
    );

  const differenceDays =
    Math.round(
      (
        deadline.getTime() -
        today.getTime()
      ) /
      (24 * 60 * 60 * 1000)
    );

  if (
    differenceDays === 1
  ) {
    noticeElement.textContent =
      "明日が提出日です";

    noticeElement.classList.remove(
      "hidden"
    );

    return;
  }

  if (
    differenceDays === 0
  ) {
    noticeElement.textContent =
      "本日中に提出してください";

    noticeElement.classList.add(
      "is-today"
    );

    noticeElement.classList.remove(
      "hidden"
    );
  }
}


/* =========================================
   出勤簿提出状況読込
========================================= */

async function loadAttendanceSubmissionStatus() {
  const loginUser =
    getMyPageLoginUser();

  if (
    !loginUser ||
    !loginUser.id
  ) {
    window.location.href =
      "login.html";

    return;
  }

  if (attendanceSubmissionStatus) {
    attendanceSubmissionStatus
      .textContent =
        "確認中...";
  }

  try {
    const targetMonth =
      getMyPageAttendanceMonth();

    const range =
      getMyPageAttendanceRange(
        targetMonth
      );

    const url =
      `${MY_PAGE_SUPABASE_URL}/rest/v1/attendance` +
      `?select=status` +
      `&employee_id=eq.${encodeURIComponent(loginUser.id)}` +
      `&work_date=gte.${range.firstDay}` +
      `&work_date=lt.${range.nextFirstDay}`;

    const response =
      await portalFetch(url);

    if (!response.ok) {
      console.error(
        await response.text()
      );

      throw new Error(
        "出勤簿の提出状況を読み込めませんでした"
      );
    }

    const attendanceRecords =
      await response.json();

    const submitted =
      attendanceRecords.some(
        record =>
          record.status === "submitted" ||
          record.status === "locked"
      );

    if (attendanceSubmissionStatus) {
      showAttendanceSubmissionStatus(
        submitted,
        targetMonth
      );
    }

    return createMyPageSubmissionResult(
      submitted,
      targetMonth,
      20
    );

  } catch (error) {
    console.error(error);

    if (attendanceSubmissionStatus) {
      attendanceSubmissionStatus
        .textContent =
          "確認失敗";
    }

    return null;
  }
}


/* =========================================
   向上提案提出状況読込
========================================= */

async function loadImprovementSubmissionStatus() {
  const loginUser =
    getMyPageLoginUser();

  if (!loginUser) {
    window.location.href =
      "login.html";

    return;
  }

  if (improvementSubmissionStatus) {
    improvementSubmissionStatus.textContent =
      "確認中...";
  }

  try {
    const settingUrl =
      `${MY_PAGE_SUPABASE_URL}/rest/v1/improvement_settings` +
      `?select=target_month` +
      `&is_published=eq.true` +
      `&order=target_month.desc` +
      `&limit=1`;

    const settingResponse =
      await portalFetch(settingUrl);

    if (!settingResponse.ok) {
      console.error(
        await settingResponse.text()
      );

      throw new Error(
        "向上提案の月別設定を読み込めませんでした"
      );
    }

    const settings =
      await settingResponse.json();

    if (settings.length === 0) {
      if (improvementSubmissionStatus) {
        showMonthlySubmissionStatus(
          improvementSubmissionStatus,
          false,
          improvementDeadlineNotice,
          25,
          null
        );
      }

      return createMyPageSubmissionResult(
        false,
        null,
        25
      );
    }

    const targetMonth =
      settings[0].target_month;

    const improvementUrl =
      `${MY_PAGE_SUPABASE_URL}/rest/v1/improvements` +
      `?select=id` +
      `&target_month=eq.${targetMonth}` +
      `&department=eq.${encodeURIComponent(
        loginUser.department || ""
      )}` +
      `&employee_name=eq.${encodeURIComponent(
        loginUser.name || ""
      )}` +
      `&status=eq.submitted` +
      `&limit=1`;

    const improvementResponse =
      await portalFetch(improvementUrl);

    if (!improvementResponse.ok) {
      console.error(
        await improvementResponse.text()
      );

      throw new Error(
        "向上提案の提出状況を読み込めませんでした"
      );
    }

    const improvements =
      await improvementResponse.json();

    const submitted =
      improvements.length > 0;

    if (improvementSubmissionStatus) {
      showMonthlySubmissionStatus(
        improvementSubmissionStatus,
        submitted,
        improvementDeadlineNotice,
        25,
        targetMonth
      );
    }

    return createMyPageSubmissionResult(
      submitted,
      targetMonth,
      25
    );

  } catch (error) {
    console.error(error);

    if (improvementSubmissionStatus) {
      improvementSubmissionStatus.textContent =
        "確認失敗";
    }

    return null;
  }
}


/* =========================================
   ヒヤリハット提出状況読込
========================================= */

async function loadNearMissSubmissionStatus() {
  const loginUser =
    getMyPageLoginUser();

  if (!loginUser) {
    window.location.href =
      "login.html";

    return;
  }

  if (nearMissSubmissionStatus) {
    nearMissSubmissionStatus.textContent =
      "確認中...";
  }

  try {
    const targetMonth =
      `${getMyPageAttendanceMonth()}-01`;

    const nearMissUrl =
      `${MY_PAGE_SUPABASE_URL}/rest/v1/near_misses` +
      `?select=id` +
      `&target_month=eq.${targetMonth}` +
      `&department=eq.${encodeURIComponent(
        loginUser.department || ""
      )}` +
      `&employee_name=eq.${encodeURIComponent(
        loginUser.name || ""
      )}` +
      `&status=eq.submitted` +
      `&limit=1`;

    const response =
      await portalFetch(nearMissUrl);

    if (!response.ok) {
      console.error(
        await response.text()
      );

      throw new Error(
        "ヒヤリハットの提出状況を読み込めませんでした"
      );
    }

    const nearMissRecords =
      await response.json();

    const submitted =
      nearMissRecords.length > 0;

    if (nearMissSubmissionStatus) {
      showMonthlySubmissionStatus(
        nearMissSubmissionStatus,
        submitted,
        nearMissDeadlineNotice,
        25,
        targetMonth
      );
    }

    return createMyPageSubmissionResult(
      submitted,
      targetMonth,
      25
    );

  } catch (error) {
    console.error(error);

    if (nearMissSubmissionStatus) {
      nearMissSubmissionStatus.textContent =
        "確認失敗";
    }

    return null;
  }
}


if (attendanceSubmissionStatus) {
  loadAttendanceSubmissionStatus();
  loadImprovementSubmissionStatus();
  loadNearMissSubmissionStatus();
}
