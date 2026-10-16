// Employee-centered managed car registration. Profile saving remains independent.
window.EmployeeVehicleAdmin = (() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const number = $('employeeManagedVehicleNumber'), name = $('employeeManagedVehicleName');
  let state = null;
  function controls(disabled) {
    [number, name, $('employeeVehicleSave'), $('employeeVehicleReload')].forEach(el => { el.disabled = disabled; });
  }
  async function rpc(method, body) {
    const response = await portalFetch(`${PORTAL_SUPABASE_URL}/rest/v1/rpc/${method}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data?.message || 'vehicle_request_failed');
    return data;
  }
  function errorText(error) {
    const text = String(error?.message || error);
    if (text.includes('application_admin_required')) return '管理車両の変更は全体管理者のみ可能です。';
    if (text.includes('changed') || text.includes('conflict')) return '車両または使用社員が変更されました。管理車両を再読み込みしてください。';
    if (text.includes('managed_vehicle_name_mismatch')) return 'この番号の車両は異なる車両名で登録されています。既存の車両名を確認してください。過去の車両は上書きしません。';
    if (text.includes('active_assignment_employee_required')) return '管理車両の登録には有効な社員を選択してください。';
    return '管理車両を更新できませんでした。接続・権限を確認して再度お試しください。';
  }
  function matched() { return state?.data?.vehicles.find(v => v.vehicle_number === number.value.trim()); }
  function source(car) { return car && state.data.employees.find(e => e.default_vehicle_id === car.id && String(e.id) !== state.id); }
  function preview() {
    if (!state?.data) return;
    const car = matched(), from = source(car);
    $('employeeVehicleOwner').textContent = from ? `現在の管理社員：${from.name}さん。移動するとこの社員の管理車両は未設定になります。` :
      car ? `登録済み車両：${car.vehicle_number} ／ ${car.vehicle_name}${car.active ? '' : '（現在無効・保存時に再有効化）'}` : '新しい車両として登録します。';
  }
  async function open(employeeId) {
    const context = { id: String(employeeId), data: null, employee: null, saving: false };
    state = context; controls(true); number.value = ''; name.value = '';
    $('employeeVehicleSection').hidden = !isAllEmployeeAdministrator();
    if ($('employeeVehicleSection').hidden) return;
    $('employeeVehicleMessage').textContent = '管理車両を読み込み中…';
    $('employeeVehicleOwner').textContent = '';
    try {
      const data = await rpc('admin_get_vehicle_master', {});
      if (state !== context) return;
      const employee = data.employees.find(e => String(e.id) === context.id);
      if (!employee) throw new Error('employee_not_found');
      context.data = data; context.employee = employee;
      const current = data.vehicles.find(v => v.id === employee.default_vehicle_id);
      number.value = current?.vehicle_number || ''; name.value = current?.vehicle_name || '';
      context.originalNumber = number.value; context.originalName = name.value;
      controls(!employee.active); $('employeeVehicleReload').disabled = false;
      preview(); $('employeeVehicleMessage').textContent = employee.active ? '' : '無効社員の管理車両は変更できません。';
    } catch (error) {
      if (state !== context) return;
      $('employeeVehicleMessage').textContent = errorText(error); $('employeeVehicleReload').disabled = false;
    }
  }
  async function save() {
    const context = state;
    if (!context?.data || context.saving || $('employeeVehicleSave').disabled) return;
    const plate = number.value.trim(), label = name.value.trim();
    if (!plate || !label || plate.length > 100 || label.length > 100) {
      $('employeeVehicleMessage').textContent = '車両番号・車両名を100文字以内で入力してください。'; return;
    }
    const car = matched(), from = source(car);
    if (car && car.vehicle_name !== label) {
      $('employeeVehicleMessage').textContent = errorText(new Error('managed_vehicle_name_mismatch')); return;
    }
    const messages = [`${context.employee.name}さんの管理車両を保存します。`, `${plate} ／ ${label}`];
    if (from) messages.push(`移動元：${from.name}さん。移動後、この社員の管理車両は未設定になります。`);
    if (car && !car.active) messages.push('登録済みの車両を再有効化します。');
    if (context.employee.default_vehicle_id != null && context.employee.default_vehicle_id !== car?.id) messages.push('現在の管理車両は無効化して保持します。過去の日報は変更しません。');
    if (!window.confirm(messages.join('\n'))) return;
    context.saving = true; controls(true); $('employeeVehicleMessage').textContent = '保存中…';
    try {
      const saved = await rpc('admin_set_employee_managed_vehicle', {
        p_employee_id: context.employee.id, p_vehicle_number: plate, p_vehicle_name: label,
        p_expected_assignments: context.data.assignments, p_expected_source_employee_id: from?.id ?? null
      });
      if (typeof employeeRecords !== 'undefined') {
        const employee = employeeRecords.find(e => String(e.id) === context.id);
        if (employee) employee.default_vehicle_id = saved;
        if (from) { const old = employeeRecords.find(e => e.id === from.id); if (old) old.default_vehicle_id = null; }
      }
      if (state !== context) return;
      await open(context.id);
      if (state?.id === context.id) $('employeeVehicleMessage').textContent = state.data ? '管理車両を保存しました。' : '保存しましたが再読み込みに失敗しました。';
    } catch (error) { if (state === context) $('employeeVehicleMessage').textContent = errorText(error); }
    finally { context.saving = false; if (state === context) controls(false); }
  }
  $('employeeVehicleSave').onclick = save;
  $('employeeVehicleReload').onclick = () => {
    if (state && !state.saving && (!state.data ||
      (number.value === state.originalNumber && name.value === state.originalName) || window.confirm('未保存の車両入力を破棄して再読み込みしますか？'))) open(state.id);
  };
  number.oninput = preview;
  return { open, close() { state = null; controls(true); $('employeeVehicleSection').hidden = true; } };
})();
