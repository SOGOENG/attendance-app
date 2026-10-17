(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const monthly = DrivingReportMonthMode;
  let monthLocked = false, conflictBlocked = false;
  const isReadOnly = () => report?.status === 'submitted' || monthLocked;
  const API = `${PORTAL_SUPABASE_URL}/rest/v1/`;
  const expectedCodes = ['brake_horn', 'lights', 'mirror_visibility', 'tires', 'exterior_interior',
    'driving_posture_seatbelt', 'mobile_phone', 'oil_leak', 'sleep_fatigue', 'physical_condition',
    'alcohol_condition', 'medication', 'worries'];
  let employee, definitions = [], report = null, inspections = [], alcoholChecks = [], refuels = [];
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
    if (busy || !ready || conflictBlocked || isReadOnly() || status() === 'no_driving') return;
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
  let odometerRequest = 0, suggestedStart = null, startManuallyEdited = false;
  function updateDistance() {
    updateMeterError();
    const start = $('startOdometer'), end = $('endOdometer');
    const valid = status() !== 'no_driving' && start.value !== '' && end.value !== '' &&
      start.validity.valid && end.validity.valid && Number(end.value) >= Number(start.value);
    $('distanceKm').textContent = valid
      ? `${(Math.round(Number(end.value) * 10) - Math.round(Number(start.value) * 10)) / 10} km` : '— km';
  }
  function showMeterError(text = '', id = 'endOdometer') {
    const previous = $('odometerError').textContent;
    if (!text && previous && $('drivingMessage').textContent === previous) message('メーターの入力を修正しました。');
    $('odometerError').textContent = text;
    $('odometerError').hidden = !text;
    for (const field of ['startOdometer', 'endOdometer']) {
      if (text && field === id) $(field).setAttribute('aria-invalid', 'true');
      else $(field).removeAttribute('aria-invalid');
    }
  }
  function updateMeterError() {
    if (status() === 'no_driving') { showMeterError(); return; }
    for (const [id, label] of [['startOdometer','出発メーター'], ['endOdometer','帰着メーター']]) {
      const field = $(id);
      if (field.validity.badInput || (field.value !== '' && !field.validity.valid)) {
        showMeterError(`${label}は0～9999999999.9の数値を小数第1位までで入力してください。`, id);
        return;
      }
    }
    if ($('startOdometer').value !== '' && $('endOdometer').value !== '' &&
      Number($('endOdometer').value) < Number($('startOdometer').value)) {
      showMeterError('帰着メーターは出発メーター以上を入力してください');
    } else showMeterError();
  }
  async function suggestStartOdometer() {
    const token = ++odometerRequest;
    if (isReadOnly() || startManuallyEdited ||
      ($('startOdometer').value !== '' && $('startOdometer').value !== suggestedStart)) return;
    const reportId = report?.id ?? null;
    const vehicle = $('vehicleId').value, date = loadedDate;
    $('startOdometer').value = '';
    suggestedStart = null;
    updateDistance();
    $('odometerHint').textContent = '';
    if (!vehicle || status() === 'no_driving') return;
    $('odometerHint').textContent = '前回の帰着メーターを確認中…';
    const current = () => token === odometerRequest && (report?.id ?? null) === reportId &&
      report?.status !== 'submitted' && !startManuallyEdited && $('startOdometer').value === '' && loadedDate === date &&
      $('reportDate').value === date && $('vehicleId').value === vehicle && status() !== 'no_driving';
    try {
      const value = await write('rpc/previous_vehicle_end_odometer', 'POST',
        { p_vehicle_id: vehicle, p_report_date: date });
      if (!current()) return;
      if (value === null) {
        $('odometerHint').textContent = '前回記録がありません。出発メーターを入力してください。';
        return;
      }
      if (!['number', 'string'].includes(typeof value) || !/^\d+(\.\d)?$/.test(String(value)) ||
        !Number.isFinite(Number(value)) || Number(value) < 0 || Number(value) > 9999999999.9) {
        throw new Error('invalid_odometer');
      }
      $('startOdometer').value = value;
      suggestedStart = $('startOdometer').value;
      $('odometerHint').textContent = '同じ車両の直近の過去日報から入力しました。手動で修正できます。';
      dirty = true;
      updateDistance();
    } catch (error) {
      if (current() && error.code === '42501') {
        $('odometerHint').textContent = 'この車両の前回値は参照できません。出発メーターを手入力してください。車両の選択・日報の保存はできます。';
        return;
      }
      if (current()) $('odometerHint').textContent = '前回の帰着メーターを取得できませんでした。出発メーターを手入力してください。';
    }
  }
  function lock() {
    $('drivingEditor').disabled = busy || !ready || conflictBlocked || isReadOnly();
    $('reportDate').disabled = busy || !initialized;
    $('reloadReport').disabled = busy || !initialized;
    updateSaveButton();
  }
  const shouldSubmit = () => status() === 'no_driving' || $('endOdometer').value !== '' || $('endOdometer').validity.badInput;
  function updateSaveButton() {
    $('saveDraft').textContent = busy ? '処理中…' : isReadOnly() ? '提出済み' : shouldSubmit() ? '提出' : '下書き保存';
    if(monthly.enabled){$('saveDraft').textContent=busy?'処理中…':isReadOnly()?'提出済み':'一時保存（朝）';$('saveReturn').hidden=false;$('saveReturn').textContent=busy?'処理中…':'保存（帰り）';}
    $('noDrivingNote').textContent = monthly.enabled?'「本日運転なし」として保存します。月別提出までは編集できます。':'「本日運転なし」として提出します。メーター入力は不要です。';
  }
  function validateSubmission(data) {
    if (data.parent.driving_status === 'no_driving') {
      if (alcoholChecks.some(c => ['before','after'].includes(c.check_type))) {
        throw new Error('旧方式のアルコール記録があるため、運転なしでは提出できません。');
      }
      if (refuels.length) throw new Error('保存済みの給油記録があるため、運転なしでは提出できません。');
      return; // The RPC also validates saved accident data.
    }
    for (const [id, value, label] of [
      ['vehicleId', data.parent.vehicle_id, '車両'],
      ['outboundRoute', data.parent.outbound_route_type, '行き経路'],
      ['returnRoute', data.parent.return_route_type, '帰り経路'],
      ['startOdometer', data.parent.start_odometer, '出発メーター'],
      ['endOdometer', data.parent.end_odometer, '帰着メーター']
    ]) if (value == null || value === '') invalid(id, `${label}を入力してください。`);
    for (const item of definitions) {
      if (!data.items.some(i => i.inspection_item_code === item.inspection_item_code)) {
        invalid(`result-${item.inspection_item_code}`, '提出には13項目すべての点検結果が必要です。');
      }
    }
    for (const [type, prefix] of [['commute_before','alcohol'],['return_before','returnAlcohol']]) {
      const check = data.alcohol.find(c => c.check_type === type);
      for (const [suffix, value] of [['Time',check?.checked_at],['Value',check?.alcohol_value],
        ['Phone',check?.phone_confirmed],['Confirmer',check?.confirmed_by_name_snapshot]]) {
        if (value == null || value === '') invalid(prefix+suffix, '提出には両アルコールチェックの4項目すべてが必要です。');
      }
    }
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
  let refuelSerial = 0, refuelSaveUncertain = false;
  function addRefuelRow(saved = null) {
    const key = ++refuelSerial;
    const row = document.createElement('div');
    row.className = 'driving-refuel-row';
    if (saved) row.dataset.savedId = String(saved.id);
    row.innerHTML = `<h4>給油記録</h4><div class="driving-grid">
      <label for="refuelLiters-${key}">給油量（L）<input id="refuelLiters-${key}" data-refuel="liters" type="number" inputmode="decimal" min="0.001" max="999999.999" step="0.001"></label>
      <label for="refuelMeter-${key}">給油時メーター（km）<input id="refuelMeter-${key}" data-refuel="meter" type="number" inputmode="decimal" min="0" max="9999999999.9" step="0.1"></label>
      <label>給油日<input data-refuel="date" type="date" readonly aria-label="給油日（日報の日付）"></label></div>
      <button type="button" class="driving-secondary">この給油を削除</button>`;
    row.querySelector('[data-refuel="liters"]').value = saved?.liters ?? '';
    row.querySelector('[data-refuel="meter"]').value = saved?.odometer_km ?? '';
    row.querySelector('[data-refuel="date"]').value = saved ? tokyoDate(saved.refueled_at) : $('reportDate').value;
    row.querySelector('button').onclick = () => {
      if (busy || !ready || conflictBlocked || isReadOnly()) return;
      FuelReceipts.dispose(row);
      row.remove(); dirty = true;
      if (!$('refuelRows').children.length) $('refuelChoice').value = 'none';
      visibility();
    };
    $('refuelRows').append(row);
    FuelReceipts.attach(row,saved?.id);
    return row;
  }
  function collectRefuels(noDriving, date, vehicle) {
    if (noDriving || $('refuelChoice').value !== 'yes') return [];
    if (!vehicle) invalid('vehicleId', '給油記録を保存する車両を選択してください。');
    return [...$('refuelRows').children].map(row => {
      const litersField = row.querySelector('[data-refuel="liters"]');
      const meterField = row.querySelector('[data-refuel="meter"]');
      const liters = number(litersField.id, '給油量'), odometer = number(meterField.id, '給油時メーター');
      if (liters === null) invalid(litersField.id, '給油量を入力してください。');
      if (odometer === null) invalid(meterField.id, '給油時メーターを入力してください。');
      const old = refuels.find(r => String(r.id) === row.dataset.savedId);
      return { row, old, body: { liters, odometer_km: odometer,
        refueled_at: old ? old.refueled_at : new Date(`${date}T00:00:00+09:00`).toISOString() } };
    });
  }
  async function saveRefuels(entries) {
    const filter = `driving_report_id=eq.${report.id}`;
    for (const entry of entries) {
      const old = refuels.find(r => String(r.id) === entry.row.dataset.savedId);
      if (old && Number(old.liters) === entry.body.liters &&
        Number(old.odometer_km) === entry.body.odometer_km && old.odometer_km !== null && old.refueled_at === entry.body.refueled_at) continue;
      let rows;
      if (old) {
        rows = await write(`driving_refuels?${filter}&id=eq.${old.id}`, 'PATCH', entry.body);
      } else {
        // A lost INSERT response is ambiguous: require reload before retry to avoid duplicates.
        try { rows = await write('driving_refuels', 'POST', { ...entry.body, driving_report_id: report.id }); }
        catch (error) { refuelSaveUncertain = true; throw error; }
      }
      if (!rows?.[0]?.id) { refuelSaveUncertain = true; throw new Error('給油記録の保存結果を確認できません。'); }
      const saved = rows[0];
      entry.row.dataset.savedId = String(saved.id);
      refuels = [...refuels.filter(r => String(r.id) !== String(saved.id)), saved];
    }
    for (const entry of entries) await FuelReceipts.save(entry.row,Number(entry.row.dataset.savedId));
    const keep = new Set(entries.map(e => e.row.dataset.savedId));
    for (const old of [...refuels]) {
      if (keep.has(String(old.id))) continue;
      await FuelReceipts.removeForRefuel(old.id);
      await write(`driving_refuels?${filter}&id=eq.${old.id}`, 'DELETE');
      refuels = refuels.filter(r => String(r.id) !== String(old.id));
    }
    if (!entries.length && $('refuelChoice').value === 'none') {
      [...$('refuelRows').children].forEach(row=>FuelReceipts.dispose(row));
      $('refuelRows').replaceChildren();
    }
  }
  function visibility() {
    const noDriving = status() === 'no_driving';
    document.querySelectorAll('[data-driving]').forEach(el => {
      el.hidden = noDriving;
      el.querySelectorAll('input,select,textarea,button').forEach(control => { control.disabled = noDriving; });
    });
    $('refuelFields').hidden = $('refuelChoice').value !== 'yes';
    $('noDrivingNote').hidden = !noDriving;
    updateDistance();
    updateSaveButton();
    $('routeNoteLabel').hidden = $('outboundRoute').value !== 'other';
    $('destinationTextLabel').hidden = $('siteId').value !== '__other__';
    definitions.forEach(item => {
      $(`note-label-${item.inspection_item_code}`).hidden = $(`result-${item.inspection_item_code}`).value !== 'defect';
    });
  }
  function populate() {
    editedTimes.clear();
    refuelSaveUncertain = false;
    [...$('refuelRows').children].forEach(row=>FuelReceipts.dispose(row));
    $('refuelRows').replaceChildren();
    $('refuelChoice').value = refuels.length ? 'yes' : 'none';
    refuels.forEach(addRefuelRow);
    suggestedStart = null; startManuallyEdited = false;
    const r = report || {};
    document.querySelector(`[name="drivingStatus"][value="${r.driving_status || 'driven'}"]`).checked = true;
    const initialVehicle = report ? r.vehicle_id : employee.default_vehicle_id;
    selectSaved('vehicleId', initialVehicle,
      report ? `${r.vehicle_number_snapshot || '車両番号未保存'} ／ ${r.vehicle_name_snapshot || '車両名未保存'}` : '', !!report);
    selectSaved('siteId', r.destination_text != null ? '__other__' : r.site_id, r.site_name_snapshot);
    $('destinationText').value = r.destination_text || '';
    $('outboundRoute').value = r.outbound_route_type || '';
    $('returnRoute').value = r.return_route_type || '';
    $('routeNote').value = r.route_note || '';
    $('startOdometer').value = r.start_odometer ?? '';
    $('endOdometer').value = r.end_odometer ?? '';
    $('odometerHint').textContent = '';
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
    ++odometerRequest;
    busy = true; ready = false; lock(); message('日報を読み込み中…');
    try {
      const date = validateDate();
      monthLocked=false;conflictBlocked=false;
      if(monthly.enabled){const month=DrivingReportPeriod.closingMonth(date);const checked=monthly.validCheck(await monthly.rpc('check_driving_report_month',month),month);monthLocked=checked.already_submitted;}
      const rows = await request(`driving_reports?select=*&employee_id=eq.${employee.id}&report_date=eq.${date}`);
      report = rows[0] || null;
      [inspections, alcoholChecks, refuels] = [[], [], []];
      if (report) {
        const [items, checks, fuelRows] = await Promise.all([
          request(`driving_report_inspections?select=*&driving_report_id=eq.${report.id}`),
          request(`driving_alcohol_checks?select=*&driving_report_id=eq.${report.id}`),
          all(`driving_refuels?select=*&driving_report_id=eq.${report.id}&order=refueled_at.asc,id.asc`)
        ]);
        inspections = items; alcoholChecks = checks; refuels = fuelRows;
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
      populate(); loadedDate = date; dirty = false;
      await suggestStartOdometer();
      ready = true;
      message(isReadOnly() ? 'この日の日報は提出済みです' :
        report ? '保存済みの下書きを読み込みました。' : 'この日の日報を新しく入力できます。');
    } catch (error) { message(`読み込めませんでした。入力を保護するため保存できません。「この日を再読み込み」で再試行してください。 ${error.message}`, true); }
    finally { busy = false; lock(); }
  }
  function invalid(id, text) {
    if (['startOdometer', 'endOdometer'].includes(id)) showMeterError(text, id);
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
      return_route_type: noDriving ? null : ($('returnRoute').value || null),
      site_id: noDriving || freeDestination ? null : ($('siteId').value || null),
      destination_text: destination,
      start_odometer: noDriving ? null : number('startOdometer', '出発メーター'),
      end_odometer: noDriving ? null : number('endOdometer', '帰着メーター'),
      route_note: noDriving ? null : ($('routeNote').value.trim() || null) };
    // Legacy alcohol and other later-day data stay untouched.
    if (!noDriving && parent.start_odometer != null && parent.end_odometer != null && parent.end_odometer < parent.start_odometer) {
      invalid('endOdometer', '帰着メーターは出発メーター以上を入力してください');
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
    const fuelEntries = collectRefuels(noDriving, date, parent.vehicle_id);
    return { parent, items, alcohol, date, fuelEntries };
  }

  async function save(event) {
    event.preventDefault();
    if (busy || !ready || conflictBlocked || isReadOnly()) return;
    if (refuelSaveUncertain) { message('給油記録が保存された可能性があります。重複防止のため、この日を再読み込みして確認してください。入力内容は残しています。', true); return; }
    const returning=monthly.enabled&&event.submitter?.id==='saveReturn';
    const submitting = !monthly.enabled&&shouldSubmit();
    let incomplete='';
    let data;
    try { data = collect(); if (submitting) validateSubmission(data);
      if(returning){try{validateSubmission(data);}catch(error){incomplete=error.message.replaceAll('提出には','月別提出には');}}
      if(monthly.enabled&&data.parent.driving_status==='no_driving'&&(refuels.length||alcoholChecks.some(c=>['before','after'].includes(c.check_type))))throw Error('保存済みの給油・旧方式の記録があります。内容を確認してから運転なしへ変更してください。');
    } catch (error) { message(error.message, true); return; }
    busy = true; lock();
    try {
      if(monthly.enabled){const month=DrivingReportPeriod.closingMonth(data.date);const checked=monthly.validCheck(await monthly.rpc('check_driving_report_month',month),month);if(checked.already_submitted){monthLocked=true;throw Error('この月は提出済みです。保存できません。');}}
      const missing = await FuelReceipts.missing(data.fuelEntries.map(e=>e.row));
      if (submitting && !window.confirm(`${missing ? `領収書が未添付の給油記録が${missing}件あります。後日経理へ原本を提出してください。\n` : ''}この日の日報を提出しますか？提出後は編集できません。`)) { busy=false; lock(); return; }
    } catch(error) { if(monthly.conflict(error))conflictBlocked=true;message(monthly.conflict(error)?monthly.conflictMessage:error.message,true);busy=false;lock();return; }
    ++odometerRequest;
    message(submitting ? '日報を提出中…' : '下書きを保存中…');
    try {
      let rows;
      if (report) rows = await write(`driving_reports?id=eq.${report.id}&employee_id=eq.${employee.id}&status=eq.draft`, 'PATCH', data.parent);
      else rows = await write('driving_reports', 'POST', { ...data.parent, employee_id: employee.id, report_date: data.date, status: 'draft' });
      if (!rows?.[0] || rows[0].status !== 'draft') throw new Error('この日の日報の状態が変わりました。再読み込みしてください。');
      report = rows[0];
      suggestedStart = null;
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
      await saveRefuels(data.fuelEntries);
      inspections = data.items;
      alcoholChecks = [...alcoholChecks.filter(c => ['before','after'].includes(c.check_type)), ...data.alcohol];
      editedTimes.clear();
      if (submitting) {
        const submitted = await write('rpc/submit_driving_report', 'POST', { p_driving_report_id: report.id });
        if (!submitted || submitted.id !== report.id || submitted.status !== 'submitted') {
          throw new Error('提出結果を確認できません。この日を再読み込みして確認してください。');
        }
        report = submitted;
      }
      dirty = false;
      message(monthly.enabled?`${returning?'保存（帰り）':'一時保存（朝）'}しました。月別提出までは編集できます。${incomplete?' 未完了：'+incomplete:''}`:submitting ? '日報を提出しました。提出済みのため編集できません。' : '下書き保存しました。提出はしていません。');
    } catch (error) {
      dirty = true;
      if(monthly.conflict(error)||error.message?.includes('driving_month_already_submitted')){conflictBlocked=true;message(monthly.conflictMessage,true);return;}
      message(`${refuelSaveUncertain ? '給油記録の重複防止のため、再保存の前にこの日を再読み込みしてください。' : ''}${submitting ? '提出が完了していません。再読み込みで提出状態を確認できます。' : ''}保存が完了していません。一部だけ保存されている場合があります。入力内容を残していますので再保存してください。別画面での変更や同日重複の場合は再読み込みしてください。 ${error.message}`, true);
    } finally { busy = false; lock(); }
  }
  for (const prefix of ['alcohol', 'returnAlcohol']) {
    $(prefix+'Now').onclick = () => setCurrentTime(prefix);
    $(prefix+'Time').addEventListener('input', () => { editedTimes.add(prefix); });
  }
  $('refuelChoice').addEventListener('change', () => {
    if ($('refuelChoice').value === 'yes' && !$('refuelRows').children.length) addRefuelRow();
    visibility();
  });
  $('addRefuel').onclick = () => {
    if (busy || !ready || conflictBlocked || isReadOnly()) return;
    addRefuelRow(); dirty = true; visibility();
  };
  $('vehicleId').addEventListener('change', () => { void suggestStartOdometer(); });
  $('startOdometer').addEventListener('input', () => {
    startManuallyEdited = true; suggestedStart = null;
    ++odometerRequest;
    $('odometerHint').textContent = '';
    updateDistance();
  });
  $('endOdometer').addEventListener('input', () => { updateDistance(); updateSaveButton(); });
  document.querySelectorAll('[name="drivingStatus"]').forEach(control => control.addEventListener('change', () => {
    ++odometerRequest;
    $('odometerHint').textContent = '';
  }));
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
      if(monthly.blocked)throw Error('月別方式は準備中です。本番接続では利用できません。');
      if(monthly.enabled){$('drivingModeLabel').textContent='月別提出方式';$('drivingIntro').textContent='朝と帰りに下書き保存します。正式提出は月別一覧から行います。';document.querySelector('.driving-back').href='driving-report-month.html?mode=monthly';}
      const initialDate = DrivingReportPeriod.initialDate(window.location.search);
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
      $('reportDate').value = initialDate;
      await loadDate();
    } catch (error) { message(`初期化できませんでした。ページを再読み込みしてください。 ${error.message}`, true); }
    finally { busy = false; lock(); }
  })();
})();
