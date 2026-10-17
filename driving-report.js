(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const API = `${PORTAL_SUPABASE_URL}/rest/v1/`;
  const expectedCodes = ['brake_horn', 'lights', 'mirror_visibility', 'tires', 'exterior_interior',
    'driving_posture_seatbelt', 'mobile_phone', 'oil_leak', 'sleep_fatigue', 'physical_condition',
    'alcohol_condition', 'medication', 'worries'];
  let employee, definitions = [], report = null, inspections = [], alcoholChecks = [];
  let busy = true, initialized = false, ready = false, dirty = false, loadedDate = '';
  const status = () => document.querySelector('[name="drivingStatus"]:checked').value;
  const message = (text, error = false) => {
    $('drivingMessage').textContent = text;
    $('drivingMessage').classList.toggle('is-error', error);
    $('saveFeedback').textContent = text;
    $('saveFeedback').classList.toggle('is-error', error);
  };
  function tokyoParts(value = new Date()) {
    return Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Tokyo',
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
      second: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(value)).map(p => [p.type, p.value]));
  }
  function tokyoDate(value) {
    const p = tokyoParts(value);
    return `${p.year}-${p.month}-${p.day}`;
  }
  function tokyoInput(value) {
    if (!value) return '';
    const p = tokyoParts(value);
    return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}`;
  }
  function tokyoTime(value) {
    return value ? tokyoInput(value).slice(11, 16) : '';
  }
  // Track explicit edits so unrelated saves preserve historical dates and seconds.
  const editedTimes = new Set();
  function setCurrentTime(prefix) {
    if (busy || !ready || report?.status === 'submitted' || status() === 'no_driving') return;
    const now = new Date();
    const date = $('reportDate').value;
    if (date !== loadedDate) return;
    if (date !== tokyoDate(now) && !window.confirm(
      `日報の日付（${date}）は今日（${tokyoDate(now)}）と異なります。現在の日本時間の時刻を入力し、日報の日付で保存しますか？`)) return;
    $(prefix+'Time').value = tokyoTime(now);
    $(prefix+'Time').removeAttribute('aria-invalid');
    editedTimes.add(prefix);
    dirty = true;
  }
  function lock() {
    $('drivingEditor').disabled = busy || !ready || report?.status === 'submitted';
    $('reportDate').disabled = busy || !initialized;
    $('reloadReport').disabled = busy || !initialized;
    $('saveDraft').textContent = busy ? '処理中…' : '下書き保存';
  }
  async function request(path, options = {}) {
    const res = await portalFetch(API + path, options);
    const text = await res.text();
    let data;
    try { data = text ? JSON.parse(text) : null; }
    catch { throw new Error('サーバーの応答を確認できません。再読み込みしてください。'); }
    if (!res.ok) {
      const error = new Error(data?.message || '通信に失敗しました。');
      error.code = data?.code;
      throw error;
    }
    return data;
  }
  const write = (path, method, body, upsert = false) => request(path, {
    method, headers: { 'Content-Type': 'application/json',
      Prefer: `${upsert ? 'resolution=merge-duplicates,' : ''}return=representation` },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  async function all(path) {
    const rows = [];
    for (let offset = 0; ; offset += 500) {
      const page = await request(`${path}&limit=500&offset=${offset}`);
      rows.push(...page);
      if (page.length < 500) return rows;
    }
  }
  function options(id, rows, label) {
    for (const row of rows) {
      const option = new Option(label(row), String(row.id));
      option.dataset.masterLabel = label(row); $(id).add(option);
    }
  }
  function selectSaved(id, value, label, snapshot = false) {
    $(id).querySelectorAll('[data-saved]').forEach(el => el.remove());
    [...$(id).options].forEach(option => { if (option.dataset.masterLabel) option.textContent = option.dataset.masterLabel; });
    if (value != null && ![...$(id).options].some(o => o.value === String(value))) {
      const option = new Option(`${label || '保存済みの選択'}（現在選択対象外）`, String(value));
      option.dataset.saved = 'true';
      $(id).add(option);
    }
    if (snapshot && value != null) {
      const option = [...$(id).options].find(o => o.value === String(value));
      if (option) option.textContent = label + (option.dataset.saved ? '（現在選択対象外）' : '');
    }
    $(id).value = value ?? '';
  }
  function buildInspections() {
    for (const item of definitions) {
      const row = document.createElement('div');
      row.className = 'driving-inspection';
      // Codes are checked against the official allowlist before use as DOM IDs.
      row.innerHTML = `<label for="result-${item.inspection_item_code}"></label>
        <select id="result-${item.inspection_item_code}" data-result="${item.inspection_item_code}">
          <option value="">未入力</option><option value="ok">良好</option>
          <option value="defect">不良</option><option value="not_applicable">該当なし</option></select>
        <label id="note-label-${item.inspection_item_code}" hidden>不良の備考
          <textarea id="note-${item.inspection_item_code}" rows="2"></textarea></label>`;
      row.querySelector('label').textContent = `${item.display_order}. ${item.display_name}`;
      $('inspectionList').append(row);
    }
  }
  function visibility() {
    const noDriving = status() === 'no_driving';
    document.querySelectorAll('[data-driving]').forEach(el => {
      el.hidden = noDriving;
      el.querySelectorAll('input,select,textarea,button').forEach(control => { control.disabled = noDriving; });
    });
    $('noDrivingNote').hidden = !noDriving;
    $('routeNoteLabel').hidden = $('outboundRoute').value !== 'other';
    $('destinationTextLabel').hidden = $('siteId').value !== '__other__';
    definitions.forEach(item => {
      $(`note-label-${item.inspection_item_code}`).hidden = $(`result-${item.inspection_item_code}`).value !== 'defect';
    });
  }
  function populate() {
    editedTimes.clear();
    const r = report || {};
    document.querySelector(`[name="drivingStatus"][value="${r.driving_status || 'driven'}"]`).checked = true;
    const initialVehicle = report ? r.vehicle_id : employee.default_vehicle_id;
    selectSaved('vehicleId', initialVehicle,
      report ? `${r.vehicle_number_snapshot || '車両番号未保存'} ／ ${r.vehicle_name_snapshot || '車両名未保存'}` : '', !!report);
    selectSaved('siteId', r.destination_text != null ? '__other__' : r.site_id, r.site_name_snapshot);
    $('destinationText').value = r.destination_text || '';
    $('outboundRoute').value = r.outbound_route_type || '';
    $('routeNote').value = r.route_note || '';
    $('startOdometer').value = r.start_odometer ?? '';
    for (const item of definitions) {
      const inspection = inspections.find(i => i.inspection_item_code === item.inspection_item_code);
      $(`result-${item.inspection_item_code}`).value = inspection?.result || '';
      $(`note-${item.inspection_item_code}`).value = inspection?.note || '';
    }
    for (const [type, prefix] of [['commute_before','alcohol'],['return_before','returnAlcohol']]) {
      const check = alcoholChecks.find(c => c.check_type === type);
      $(prefix+'Time').value = tokyoTime(check?.checked_at);
      $(prefix+'Value').value = check?.alcohol_value ?? '';
      $(prefix+'Phone').value = check?.phone_confirmed == null ? '' : String(check.phone_confirmed);
      $(prefix+'Confirmer').value = check?.confirmed_by_name_snapshot || '';
    }
    const legacy = alcoholChecks.filter(c => ['before','after'].includes(c.check_type));
    $('legacyAlcohol').hidden = !legacy.length;
    $('legacyAlcoholRows').replaceChildren();
    for (const check of legacy) {
      const line = document.createElement('p');
      line.textContent = [check.check_type === 'after' ? '帰着後（旧方式）' : '出発前（旧方式）',
        tokyoInput(check.checked_at).replace('T',' '), check.alcohol_value,
        check.confirmation_method, check.confirmed_by_name_snapshot].join(' ／ ');
      $('legacyAlcoholRows').append(line);
    }
    $('drivingForm').querySelectorAll('[aria-invalid]').forEach(el => el.removeAttribute('aria-invalid'));
    visibility();
  }
  function validateDate() {
    const date = $('reportDate').value;
    $('reportDate').max = tokyoDate();
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date) || date > tokyoDate()) {
      throw new Error('今日以前の日付を選択してください。');
    }
    return date;
  }
  async function loadDate() {
    busy = true; ready = false; lock(); message('日報を読み込み中…');
    try {
      const date = validateDate();
      const rows = await request(`driving_reports?select=*&employee_id=eq.${employee.id}&report_date=eq.${date}`);
      report = rows[0] || null;
      [inspections, alcoholChecks] = [[], []];
      if (report) {
        const [items, checks] = await Promise.all([
          request(`driving_report_inspections?select=*&driving_report_id=eq.${report.id}`),
          request(`driving_alcohol_checks?select=*&driving_report_id=eq.${report.id}`)
        ]);
        inspections = items; alcoholChecks = checks;
      } else {
        // Defaults apply ONLY to new days. Never substitute for a saved NULL,
        // existing draft, or submitted vehicle. Refresh settings on date changes.
        const [profiles, vehicles] = await Promise.all([
          request(`employees?select=default_vehicle_id&id=eq.${employee.id}&active=eq.true`),
          all('vehicles?select=id,vehicle_number,vehicle_name&active=eq.true&order=vehicle_number.asc,id.asc')
        ]);
        $('vehicleId').replaceChildren(new Option('未選択', ''));
        options('vehicleId', vehicles, v => `${v.vehicle_number}${v.vehicle_name ? ` ／ ${v.vehicle_name}` : ''}`);
        const preferred = profiles[0]?.default_vehicle_id;
        employee.default_vehicle_id = vehicles.some(v => String(v.id) === String(preferred)) ? preferred : null;
      }
      populate(); loadedDate = date; dirty = false; ready = true;
      message(report?.status === 'submitted' ? 'この日の日報は提出済みです' :
        report ? '保存済みの下書きを読み込みました。' : 'この日の日報を新しく入力できます。');
    } catch (error) { message(`読み込めませんでした。入力を保護するため保存できません。「この日を再読み込み」で再試行してください。 ${error.message}`, true); }
    finally { busy = false; lock(); }
  }
  function invalid(id, text) {
    $(id).setAttribute('aria-invalid', 'true'); $(id).focus(); throw new Error(text);
  }
  function number(id, name) {
    const field = $(id);
    if (field.validity.badInput || !field.validity.valid) invalid(id, `${name}の範囲・小数桁数を確認してください。`);
    if (!field.value.trim()) return null;
    const value = Number(field.value);
    if (!Number.isFinite(value)) invalid(id, `${name}を数値で入力してください。`);
    return value;
  }
  function collect() {
    const date = validateDate();
    if (date !== loadedDate) throw new Error('日付の読み込みが完了していません。再読み込みしてください。');
    $('drivingForm').querySelectorAll('[aria-invalid]').forEach(el => el.removeAttribute('aria-invalid'));
    const noDriving = status() === 'no_driving';
    const freeDestination = !noDriving && $('siteId').value === '__other__';
    const destination = freeDestination ? $('destinationText').value.trim() : null;
    if (freeDestination && (!destination || destination.length > 500)) {
      invalid('destinationText', '行先を500文字以内で入力してください。未指定の場合は「選択なし」を選んでください。');
    }
    const parent = { driving_status: status(), vehicle_id: noDriving ? null : ($('vehicleId').value || null),
      outbound_route_type: noDriving ? null : ($('outboundRoute').value || null),
      site_id: noDriving || freeDestination ? null : ($('siteId').value || null),
      destination_text: destination,
      start_odometer: noDriving ? null : number('startOdometer', '出発メーター'),
      route_note: noDriving ? null : ($('routeNote').value.trim() || null) };
    // Only morning columns are patched: return route, end meter, legacy alcohol,
    // refuels, accidents and other later-day data are never overwritten here.
    if (!noDriving && report?.end_odometer != null && parent.start_odometer != null && parent.start_odometer > Number(report.end_odometer)) {
      invalid('startOdometer', '出発メーターが保存済みの帰着メーターを超えています。');
    }
    const items = noDriving ? [] : definitions.flatMap(item => {
      const code = item.inspection_item_code, result = $(`result-${code}`).value;
      if (!result) return [];
      const note = result === 'defect' ? $(`note-${code}`).value.trim() : '';
      if (result === 'defect' && !note) invalid(`note-${code}`, `${item.display_name}：不良の備考を入力してください。`);
      const old = inspections.find(i => i.inspection_item_code === code);
      return [{ inspection_item_code: code, result, note: note || null,
        checked_at: old && old.result === result && (old.note || '') === note ? old.checked_at : new Date().toISOString() }];
    });
    const alcohol = [];
    if (!noDriving) for (const [type, prefix] of [['commute_before','alcohol'],['return_before','returnAlcohol']]) {
      const value = number(prefix+'Value', 'アルコール値');
      const time = $(prefix+'Time').value;
      const phone = $(prefix+'Phone').value;
      const confirmer = $(prefix+'Confirmer').value;
      if (!time && value === null && !phone && !confirmer) continue;
      let checkedAt = null;
      if (time) {
        const parsed = new Date(`${date}T${time}:00+09:00`);
        if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time) || !$(prefix+'Time').validity.valid || !Number.isFinite(parsed.getTime())) invalid(prefix+'Time','測定時刻を確認してください。');
        const old = alcoholChecks.find(c => c.check_type === type);
        checkedAt = !editedTimes.has(prefix) && old?.checked_at && tokyoTime(old.checked_at) === time
          ? old.checked_at : parsed.toISOString();
      }
      alcohol.push({check_type:type, checked_at:checkedAt, alcohol_value:value,
        phone_confirmed:phone === '' ? null : phone === 'true',
        confirmed_by_name_snapshot:confirmer || null, confirmed_by_employee_id:null});
    }
    parent.alcohol_check_version = 2;
    return { parent, items, alcohol, date };
  }

  async function save(event) {
    event.preventDefault();
    if (busy || !ready || report?.status === 'submitted') return;
    let data;
    try { data = collect(); } catch (error) { message(error.message, true); return; }
    if (data.parent.driving_status === 'no_driving' && (inspections.length || alcoholChecks.some(c => ['commute_before','return_before'].includes(c.check_type))) &&
      !window.confirm('本日運転なしとして保存すると、この日の始業点検と新方式のアルコール記録を削除します（旧方式の記録は保持）。よろしいですか？')) return;
    busy = true; lock(); message('下書きを保存中…');
    try {
      let rows;
      if (report) rows = await write(`driving_reports?id=eq.${report.id}&employee_id=eq.${employee.id}&status=eq.draft`, 'PATCH', data.parent);
      else rows = await write('driving_reports', 'POST', { ...data.parent, employee_id: employee.id, report_date: data.date, status: 'draft' });
      if (!rows?.[0] || rows[0].status !== 'draft') throw new Error('この日の日報の状態が変わりました。再読み込みしてください。');
      report = rows[0];
      const filter = `driving_report_id=eq.${report.id}`;
      if (data.parent.driving_status === 'no_driving') {
        await write(`driving_report_inspections?${filter}`, 'DELETE');
      } else {
        if (data.items.length) await write('driving_report_inspections?on_conflict=driving_report_id,inspection_item_code', 'POST',
          data.items.map(item => ({ ...item, driving_report_id: report.id })), true);
        const keep = new Set(data.items.map(i => i.inspection_item_code));
        const removed = definitions.map(i => i.inspection_item_code).filter(code => !keep.has(code));
        if (removed.length) await write(`driving_report_inspections?${filter}&inspection_item_code=in.(${removed.join(',')})`, 'DELETE');
      }
      for (const type of ['commute_before','return_before']) {
        const check = data.alcohol.find(c => c.check_type === type);
        if (check) await write('driving_alcohol_checks?on_conflict=driving_report_id,check_type','POST',
          {...check,driving_report_id:report.id},true);
        else await write('driving_alcohol_checks?'+filter+'&check_type=eq.'+type,'DELETE');
      }
      inspections = data.items;
      alcoholChecks = [...alcoholChecks.filter(c => ['before','after'].includes(c.check_type)), ...data.alcohol];
      editedTimes.clear();
      dirty = false;
      message('下書き保存しました。提出はしていません。');
    } catch (error) {
      dirty = true;
      message(`保存が完了していません。一部だけ保存されている場合があります。入力内容を残していますので再保存してください。別画面での変更や同日重複の場合は再読み込みしてください。 ${error.message}`, true);
    } finally { busy = false; lock(); }
  }
  for (const prefix of ['alcohol', 'returnAlcohol']) {
    $(prefix+'Now').onclick = () => setCurrentTime(prefix);
    $(prefix+'Time').addEventListener('input', () => { editedTimes.add(prefix); });
  }
  $('drivingForm').addEventListener('submit', save);
  $('drivingEditor').addEventListener('input', () => { dirty = true; });
  $('drivingEditor').addEventListener('change', () => { dirty = true; visibility(); });
  $('allGood').onclick = () => {
    if (definitions.some(item => $(`result-${item.inspection_item_code}`).value === 'defect') &&
      !window.confirm('不良の項目もすべて良好に変更しますか？')) return;
    definitions.forEach(item => { $(`result-${item.inspection_item_code}`).value = 'ok'; });
    dirty = true; visibility();
  };
  $('reportDate').onchange = async () => {
    if (dirty && !window.confirm('未保存の入力があります。日付を変更して読み直しますか？')) {
      $('reportDate').value = loadedDate; return;
    }
    await loadDate();
  };
  $('reloadReport').onclick = async () => {
    if (dirty && !window.confirm('未保存の入力を破棄して再読み込みしますか？')) return;
    await loadDate();
  };
  window.addEventListener('beforeunload', event => { if (dirty || busy) { event.preventDefault(); event.returnValue = ''; } });
  (async () => {
    try {
      if (!localStorage.getItem('portalLoginUser')) { redirectToPortalLogin(); return; }
      const id = await write('rpc/current_employee_id', 'POST', {});
      if (id == null || !/^\d+$/.test(String(id))) throw new Error('ログイン中の有効な社員情報を確認できません。');
      const employees = await request(`employees?select=id,name,department,default_vehicle_id&id=eq.${id}&active=eq.true`);
      if (!employees[0]) throw new Error('社員情報を読み込めません。');
      employee = employees[0];
      $('employeeName').value = [employee.name, employee.department].filter(Boolean).join(' ／ ');
      const [items, vehicles, sites] = await Promise.all([
        write('rpc/driving_report_inspection_items', 'POST', {}),
        all('vehicles?select=id,vehicle_number,vehicle_name&active=eq.true&order=vehicle_number.asc,id.asc'),
        all('sites?select=id,display_name&visible=eq.true&order=display_name.asc,id.asc')
      ]);
      if (items.length !== 13 || expectedCodes.some((code, index) => !items.some(i => i.inspection_item_code === code && i.display_order === index + 1))) {
        throw new Error('正式13点検の定義を確認できません。管理者に確認してください。');
      }
      definitions = items.sort((a, b) => a.display_order - b.display_order);
      buildInspections();
      options('vehicleId', vehicles, v => `${v.vehicle_number}${v.vehicle_name ? ` ／ ${v.vehicle_name}` : ''}`);
      options('siteId', sites, s => s.display_name);
      initialized = true;
      $('reportDate').value = tokyoDate();
      await loadDate();
    } catch (error) { message(`初期化できませんでした。ページを再読み込みしてください。 ${error.message}`, true); }
    finally { busy = false; lock(); }
  })();
})();
