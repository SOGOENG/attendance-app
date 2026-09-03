(function(){
  "use strict";

  const API = `${PORTAL_SUPABASE_URL}/rest/v1`;
  const sheet = document.getElementById("printSheet");
  const message = document.getElementById("printMessage");

  function escapeHtml(value) {
    const element = document.createElement("div");
    element.textContent = value ?? "";
    return element.innerHTML;
  }

  function formatDate(value) {
    if (!value) return "";
    const [year, month, day] = String(value).slice(0, 10).split("-");
    return `${Number(year)}年${Number(month)}月${Number(day)}日`;
  }

  async function request(path, options = {}) {
    const response = await portalFetch(`${API}/${path}`, options);
    const text = await response.text();
    const data = text ? JSON.parse(text) : null;
    if (!response.ok) throw new Error(data?.message || text || `HTTP ${response.status}`);
    return data;
  }

  async function rpc(name, body = {}) {
    return request(`rpc/${name}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
  }

  function approvalHtml(application, employeeMap) {
    const approverName = escapeHtml(
      employeeMap.get(Number(application.approved_by_employee_id)) || ""
    );
    return `<div class="approval-row"><div><span class="approval-label">承認者</span>${approverName}<br>${formatDate(application.approved_at)}</div><div><span class="approval-label">責任者</span><div class="responsible-content"><span class="responsible-name">${approverName}</span><span class="seal-space" aria-label="押印欄"></span></div></div></div>`;
  }

  function paidHtml(application, detail, applicant, siteName, balance, employeeMap) {
    const period = `${formatDate(detail.start_date)} ～ ${formatDate(detail.end_date)}`;
    return `<article class="print-copy paid-form"><h1 class="form-title">有給休暇届</h1><p class="form-meta">届出年月日　${formatDate(application.submitted_at)}</p><table class="form-table"><tr><th>氏名</th><td>${escapeHtml(applicant)}</td></tr><tr><th>現場名</th><td>${escapeHtml(siteName || "")}</td></tr><tr><th>期間</th><td>${period}</td></tr><tr><th>日数</th><td>${escapeHtml(detail.days)} 日</td></tr><tr><th>事由</th><td class="multi-line">${escapeHtml(detail.reason || "")}</td></tr><tr><th rowspan="3">会社使用欄</th><td class="company-use">支給日数　${balance ? `${escapeHtml(balance.granted_days)} 日` : ""}</td></tr><tr><td class="company-use">累積使用日数　${balance ? `${escapeHtml(balance.used_days)} 日` : ""}</td></tr><tr><td class="company-use">有給休暇残日数　${balance ? `${escapeHtml(balance.remaining_days)} 日` : ""}</td></tr></table>${approvalHtml(application, employeeMap)}</article>`;
  }

  function compHtml(application, applicant, dates, workDates, employeeMap) {
    const holidayRows = workDates.length ? workDates.map(value => `<li>${formatDate(value)}</li>`).join("") : "<li></li>";
    const leaveRows = dates.length ? dates.map(row => `<li>${formatDate(row.leave_date)}（${escapeHtml(row.days)}日）</li>`).join("") : "<li></li>";
    return `<article class="print-copy comp-form"><h1 class="form-title">代替休日請求願</h1><p class="form-meta">届出年月日　${formatDate(application.submitted_at)}</p><table class="form-table"><tr><th>氏名</th><td>${escapeHtml(applicant)}</td></tr><tr><th>休日出勤日</th><td class="multi-line"><ul class="date-list">${holidayRows}</ul></td></tr><tr><th>代替請求日</th><td class="multi-line"><ul class="date-list">${leaveRows}</ul></td></tr></table><p class="form-note">上記の通り請求いたしたくお願い致します。</p>${approvalHtml(application, employeeMap)}</article>`;
  }

  async function initialize() {
    const applicationId = Number(new URLSearchParams(location.search).get("application_id"));
    if (!Number.isInteger(applicationId) || applicationId <= 0) throw new Error("申請IDが正しくありません。");
    if (await rpc("is_application_admin") !== true) throw new Error("この帳票を印刷する権限がありません。");

    const applications = await request(`applications?select=id,employee_id,application_type,status,submitted_at,approved_at,approved_by_employee_id&id=eq.${applicationId}`);
    const application = applications[0];
    if (!application || application.status !== "approved") throw new Error("承認済み申請だけ印刷できます。");

    const employeeIds = [...new Set([application.employee_id, application.approved_by_employee_id].filter(Boolean))];
    const employees = await request(`employees?select=id,name&id=in.(${employeeIds.join(",")})`);
    const employeeMap = new Map(employees.map(row => [Number(row.id), row.name]));
    const applicant = employeeMap.get(Number(application.employee_id)) || "";
    let copyHtml;

    if (application.application_type === "paid_leave") {
      const details = await request(`paid_leave_application_details?select=start_date,end_date,days,site_id,reason&application_id=eq.${applicationId}`);
      const detail = details[0];
      if (!detail) throw new Error("有給休暇申請の詳細がありません。");
      const fiscalYear = Number(detail.start_date.slice(0, 4)) - (Number(detail.start_date.slice(5, 7)) < 4 ? 1 : 0);
      const [sites, balances] = await Promise.all([
        detail.site_id ? request(`sites?select=id,display_name&id=eq.${detail.site_id}`) : [],
        request(`paid_leave_balances?select=granted_days,used_days,remaining_days&employee_id=eq.${application.employee_id}&fiscal_year=eq.${fiscalYear}`)
      ]);
      copyHtml = paidHtml(application, detail, applicant, sites[0]?.display_name || "", balances[0] || null, employeeMap);
    } else if (application.application_type === "comp_leave") {
      const [dates, allocations] = await Promise.all([
        request(`comp_leave_dates?select=leave_date,days,display_order&application_id=eq.${applicationId}&order=display_order.asc`),
        request(`comp_leave_allocations?select=holiday_work_record_id&application_id=eq.${applicationId}`)
      ]);
      const workIds = [...new Set(allocations.map(row => row.holiday_work_record_id))];
      const workRecords = workIds.length ? await request(`holiday_work_records?select=id,work_date&id=in.(${workIds.join(",")})&order=work_date.asc`) : [];
      copyHtml = compHtml(application, applicant, dates, workRecords.map(row => row.work_date), employeeMap);
    } else {
      throw new Error("この申請種別の帳票には対応していません。");
    }

    sheet.innerHTML = copyHtml + copyHtml;
    sheet.hidden = false;
    message.hidden = true;
  }

  document.getElementById("printButton").addEventListener("click", () => window.print());
  document.getElementById("backButton").addEventListener("click", () => history.length > 1 ? history.back() : location.assign("applications-admin.html"));

  initialize().catch(error => {
    console.error(error);
    message.textContent = error.message || "帳票を読み込めませんでした。";
  });
})();
