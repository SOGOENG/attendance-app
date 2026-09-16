(() => {
  'use strict';
  const $ = id => document.getElementById(id), M = MasterAdmin;
  let records = [], busy = false, ready = false;
  function message(text) { $('clientMessage').textContent = text; }
  function render() {
    $('clientList').innerHTML = records.map((c, i) => `<article class="admin-schedule-item">
      <div class="admin-schedule-info"><strong>${M.escape(c.name)}</strong>
      <p>元請コード：${M.escape(c.code)} ／ ${c.visible ? '表示' : '非表示'}</p></div>
      <div class="admin-schedule-actions">
      <button class="master-order-button" data-index="${i}" data-direction="-1" aria-label="${M.escape(c.name)}を上へ" ${busy || !i ? 'disabled' : ''}>↑</button>
      <button class="master-order-button" data-index="${i}" data-direction="1" aria-label="${M.escape(c.name)}を下へ" ${busy || i === records.length - 1 ? 'disabled' : ''}>↓</button>
      <button class="edit-schedule-button" data-edit="${i}" ${busy ? 'disabled' : ''}>編集</button></div></article>`).join('');
    $('newClientButton').disabled = busy || !ready;
  }
  async function load() {
    records = await M.all('clients?select=*&order=display_order.asc,id.asc');
    ready = true; render();
  }
  function edit(c = {}) {
    $('clientForm').reset(); $('editingClientId').value = c.id ?? '';
    $('clientName').value = c.name ?? ''; $('clientCode').value = c.code ?? '';
    $('clientVisible').value = String(c.visible ?? true);
    $('clientFormTitle').textContent = c.id ? '元請の編集' : '新規元請登録';
    $('clientFormMessage').textContent = '';
    $('clientForm').querySelectorAll('[aria-invalid]').forEach(el => el.removeAttribute('aria-invalid'));
    $('clientEditSection').hidden = false; $('clientName').focus();
  }
  $('newClientButton').onclick = () => edit();
  $('cancelClientButton').onclick = () => { if (!busy) $('clientEditSection').hidden = true; };
  $('reloadClients').onclick = async () => {
    if (busy) return;
    try { await M.authorize(); await load(); message('一覧を更新しました'); } catch (e) { message(e.message); }
  };
  $('clientList').onclick = async event => {
    const button = event.target.closest('button'); if (!button || busy) return;
    if (button.dataset.edit !== undefined) return edit(records[Number(button.dataset.edit)]);
    const row = records[Number(button.dataset.index)]; if (!row) return;
    busy = true; render();
    try {
      await M.rpc('move_master_item', { p_kind: 'client', p_id: row.id,
        p_direction: Number(button.dataset.direction), p_expected_ids: records.map(c => c.id) });
      await load(); message('元請の順番を保存しました');
    } catch (e) { message(e.message); }
    finally { busy = false; render(); }
  };
  $('clientForm').onsubmit = async event => {
    event.preventDefault(); if (busy) return;
    try { M.validate([[$('clientName'), '元請名'], [$('clientCode'), '元請コード']]); }
    catch (e) { $('clientFormMessage').textContent = e.message; return; }
    busy = true; $('saveClientButton').disabled = true; render();
    try {
      await M.rpc('save_client_master', { p_id: $('editingClientId').value || null,
        p_name: $('clientName').value.trim(), p_code: $('clientCode').value.trim(), p_visible: $('clientVisible').value === 'true' });
      $('clientEditSection').hidden = true;
      message('元請を保存しました'); await load();
    } catch (e) { $('clientFormMessage').textContent = e.message; message(e.message); }
    finally { busy = false; $('saveClientButton').disabled = false; render(); }
  };
  (async () => { try { await M.authorize(); await load(); } catch (e) { message(e.message); } })();
})();
