(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  // Employee search has no administrator gate and never calls write APIs.
  if (!localStorage.getItem('portalLoginUser') || !getPortalAuthSession()) {
    window.location.href = 'login.html';
    return;
  }
  let sites = [], ready = false, requestId = 0;
  function render() {
    const results = $('siteSearchResults');
    results.replaceChildren();
    if (!ready) return;
    const query = $('siteSearchInput').value.trim().toLowerCase();
    const selected = $('siteSearchSelect').value;
    const matches = sites.filter(site =>
      (!selected || String(site.id) === selected) &&
      (!query || [site.display_name, site.official_name].some(name => String(name ?? '').toLowerCase().includes(query))));
    $('siteSearchStatus').textContent = `${matches.length}件`;
    if (!matches.length) {
      results.textContent = '該当する工事物件はありません';
      return;
    }
    const table = document.createElement('table');
    table.className = 'site-search-table';
    const head = table.createTHead().insertRow();
    for (const title of ['現場名', '工事番号']) {
      const cell = document.createElement('th');
      cell.scope = 'col'; cell.textContent = title; head.append(cell);
    }
    const body = table.createTBody();
    for (const site of matches) {
      const row = body.insertRow();
      row.insertCell().textContent = site.display_name || site.official_name || '名称未設定';
      row.insertCell().textContent = site.construction_no || '未登録';
    }
    results.append(table);
  }
  async function load() {
    const current = ++requestId;
    const selected = $('siteSearchSelect').value;
    const includeHidden = $('includeHiddenSites').checked;
    ready = false; sites = []; render();
    $('siteSearchSelect').disabled = true;
    $('reloadSiteSearch').disabled = true;
    $('siteSearchResultSection').setAttribute('aria-busy', 'true');
    $('siteSearchStatus').textContent = '現場マスタを読み込み中…';
    $('siteSearchError').hidden = true;
    try {
      const rows = [];
      // Advance by the actual returned count, even when the server cap is below 500.
      // An empty final page proves completion; never infer it from a short page.
      for (let offset = 0; ; ) {
        const params = new URLSearchParams({
          select: 'id,display_name,official_name,construction_no,visible',
          visible: includeHidden ? 'in.(true,false)' : 'eq.true',
          order: 'id.asc', limit: '500', offset: String(offset)
        });
        const response = await portalFetch(`${PORTAL_SUPABASE_URL}/rest/v1/sites?${params}`, { method: 'GET', cache: 'no-store' });
        if (current !== requestId) return;
        if (!response.ok) throw new Error(response.status === 403
          ? '現場情報を閲覧する権限がありません。管理者に確認してください。'
          : '現場マスタを読み込めませんでした。時間をおいて再読み込みしてください。');
        const page = await response.json();
        if (!Array.isArray(page)) throw new Error('現場マスタの応答を確認できませんでした。再読み込みしてください。');
        if (!page.length) break;
        rows.push(...page); offset += page.length;
      }
      if (current !== requestId) return;
      sites = rows.sort((a, b) => String(a.display_name ?? '').localeCompare(String(b.display_name ?? ''), 'ja') || String(a.id).localeCompare(String(b.id)));
      $('siteSearchSelect').replaceChildren(new Option('すべての現場', ''));
      for (const site of sites) $('siteSearchSelect').add(new Option(site.display_name || site.official_name || '名称未設定', String(site.id)));
      if (sites.some(site => String(site.id) === selected)) $('siteSearchSelect').value = selected;
      ready = true; $('siteSearchSelect').disabled = false; render();
    } catch (error) {
      if (current !== requestId) return;
      $('siteSearchSelect').replaceChildren(new Option('すべての現場', ''));
      $('siteSearchStatus').textContent = '';
      $('siteSearchError').textContent = error instanceof TypeError ? '通信できませんでした。接続を確認して再読み込みしてください。' : error.message;
      $('siteSearchError').hidden = false;
    } finally {
      if (current === requestId) {
        $('reloadSiteSearch').disabled = false;
        $('siteSearchResultSection').setAttribute('aria-busy', 'false');
      }
    }
  }
  $('siteSearchInput').addEventListener('input', render);
  $('siteSearchSelect').addEventListener('change', render);
  $('includeHiddenSites').addEventListener('change', load);
  $('reloadSiteSearch').addEventListener('click', load);
  load();
})();
