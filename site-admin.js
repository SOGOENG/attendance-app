(() => {
  'use strict';
  const $ = id => document.getElementById(id), M = MasterAdmin;
  let sites = [], clients = [], busy = false, ready = false;
  const group = site => String(site.client_id ?? '');
  const message = text => { $('siteMessage').textContent = text; };
  function render() {
    const search = $('siteSearchInput').value.trim().toLowerCase();
    const filtered = sites.filter(s =>
      (!search || [s.display_name,s.official_name,s.construction_no,s.input_code,s.client_name,s.master_client_name]
        .some(v => String(v ?? '').toLowerCase().includes(search))) &&
      ($('siteVisibleFilter').value === 'all' || String(s.visible) === $('siteVisibleFilter').value) &&
      ($('siteTypeFilter').value === 'all' || s.site_type === $('siteTypeFilter').value));
    // Include hidden sites in ordering; avoid swapping with invisible search results.
    const filtering = !!search || $('siteVisibleFilter').value !== 'all' || $('siteTypeFilter').value !== 'all';
    let previousGroup = null;
    $('siteList').innerHTML = filtered.map(s => {
      const key = group(s), siblings = sites.filter(x => group(x) === key), index = siblings.indexOf(s);
      const title = key !== previousGroup ? `<h3 class="master-group-title">${M.escape(s.master_client_name || '元請未設定（既存データ）')}</h3>` : '';
      previousGroup = key;
      return `${title}<article class="admin-schedule-item"><div class="admin-schedule-info">
        <strong>${M.escape(s.display_name)}</strong>
        <p>入力コード：${M.escape(s.input_code)} ／ 工事番号：${M.escape(s.construction_no)}</p>
        <p>元請：${M.escape(s.master_client_name || s.client_name)}</p>
        <p>正式名称：${M.escape(s.official_name)}</p>
        <p>${M.escape(s.site_type)} ／ ${s.visible ? '表示中' : '非表示'}</p></div>
        <div class="admin-schedule-actions">
        <button class="master-order-button" data-id="${M.escape(s.id)}" data-direction="-1" aria-label="${M.escape(s.display_name)}を上へ" ${busy || filtering || !index ? 'disabled' : ''}>↑</button>
        <button class="master-order-button" data-id="${M.escape(s.id)}" data-direction="1" aria-label="${M.escape(s.display_name)}を下へ" ${busy || filtering || index === siblings.length - 1 ? 'disabled' : ''}>↓</button>
        <button class="edit-schedule-button" data-edit="${M.escape(s.id)}" ${busy ? 'disabled' : ''}>編集</button></div></article>`;
    }).join('') || '<p>該当する現場はありません</p>';
    $('newSiteButton').disabled = busy || !ready;
    $('siteOrderNote').textContent = filtering ? '並び替えるには検索・表示状態・現場種別の絞り込みを解除してください。' : '↑ ↓ で元請内の現場順を変更できます。非表示の現場も並び順に含みます。';
  }
  async function load() {
    const result = await Promise.all([
      M.all('site_master_order?select=*&order=client_display_order.asc.nullslast,client_id.asc.nullslast,client_site_order.asc.nullslast,display_order.asc.nullslast,display_name.asc,id.asc'),
      M.all('clients?select=*&order=display_order.asc,id.asc')
    ]);
    [sites, clients] = result; ready = true; render();
  }
  function edit(s = {}) {
    $('siteForm').reset(); $('editingSiteId').value = s.id ?? '';
    const options = clients.filter(c => c.visible || String(c.id) === String(s.client_id));
    $('siteClientId').innerHTML = '<option value="">選択してください</option>' + options.map(c =>
      `<option value="${M.escape(c.id)}">${M.escape(c.name)}${c.visible ? '' : '（非表示・現在の元請）'}</option>`).join('');
    $('siteClientId').value = s.client_id ?? '';
    $('siteDisplayName').value = s.display_name ?? '';
    $('siteConstructionNo').value = s.construction_no ?? '';
    $('siteOfficialName').value = s.official_name ?? '';
    $('siteVisible').value = String(s.visible ?? true); $('siteType').value = s.site_type || '一般';
    $('siteFormTitle').textContent = s.id ? '現場情報の修正' : '新規現場登録';
    $('siteCodeNote').textContent = s.id ? `入力コード：${s.input_code ?? ''}（変更しません）` : '入力コードは保存時に自動発行し、選択した元請の一番下に追加します。';
    $('siteFormMessage').textContent = '';
    $('siteForm').querySelectorAll('[aria-invalid]').forEach(el => el.removeAttribute('aria-invalid'));
    $('siteEditSection').hidden = false; $('siteDisplayName').focus();
  }
  $('newSiteButton').onclick = () => edit();
  $('cancelSiteEditButton').onclick = () => { if (!busy) $('siteEditSection').hidden = true; };
  $('reloadSites').onclick = async () => {
    if (busy) return;
    try { await M.authorize(); await load(); message('一覧を更新しました'); } catch (e) { message(e.message); }
  };
  $('siteSearchInput').oninput = render;
  $('siteVisibleFilter').onchange = render; $('siteTypeFilter').onchange = render;
  $('siteList').onclick = async event => {
    const button = event.target.closest('button'); if (!button || busy) return;
    if (button.dataset.edit) return edit(sites.find(s => String(s.id) === button.dataset.edit));
    const row = sites.find(s => String(s.id) === button.dataset.id); if (!row) return;
    busy = true; render();
    try {
      await M.rpc('move_master_item', { p_kind: 'site', p_id: row.id,
        p_direction: Number(button.dataset.direction), p_expected_ids: sites.filter(s => group(s) === group(row)).map(s => s.id) });
      await load(); message('現場の順番を保存しました');
    } catch (e) { message(e.message); }
    finally { busy = false; render(); }
  };
  $('siteForm').onsubmit = async event => {
    event.preventDefault(); if (busy) return;
    try { M.validate([[$('siteDisplayName'),'表示名'],[$('siteClientId'),'元請'],
      [$('siteConstructionNo'),'工事番号'],[$('siteOfficialName'),'正式名称']]); }
    catch (e) { $('siteFormMessage').textContent = e.message; return; }
    busy = true; $('saveSiteButton').disabled = true; render();
    try {
      await M.rpc('save_site_master', { p_id: $('editingSiteId').value || null, p_client_id: $('siteClientId').value,
        p_display_name: $('siteDisplayName').value.trim(), p_construction_no: $('siteConstructionNo').value.trim(),
        p_official_name: $('siteOfficialName').value.trim(), p_visible: $('siteVisible').value === 'true', p_site_type: $('siteType').value });
      $('siteEditSection').hidden = true; message('現場を保存しました'); await load();
    } catch (e) { $('siteFormMessage').textContent = e.message; message(e.message); }
    finally { busy = false; $('saveSiteButton').disabled = false; render(); }
  };
  (async () => { try { await M.authorize(); await load(); } catch (e) { message(e.message); } })();
})();
