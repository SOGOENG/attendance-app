/* Shared master API/error handling. Ordering and numbering are committed in DB transactions. */
window.MasterAdmin = (() => {
  const escape = value => String(value ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[ch]);
  async function request(path, options = {}) {
    const response = await portalFetch(`${PORTAL_SUPABASE_URL}/rest/v1/${path}`, options);
    const text = await response.text();
    let data;
    try { data = text ? JSON.parse(text) : null; } catch { data = null; }
    if (!response.ok) throw new Error(data?.message || '通信に失敗しました。再読み込みしてお試しください。');
    return data;
  }
  const rpc = (name, body) => request(`rpc/${name}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  });
  async function authorize() {
    if (!(await rpc('is_site_master_admin', {}))) throw new Error('この画面を開く管理者権限がありません。');
  }
  // PostgREST caps response size: do not silently omit hidden rows from a reorder.
  async function all(path) {
    const rows = [];
    for (let offset = 0; ; offset += 500) {
      const page = await request(`${path}&limit=500&offset=${offset}`);
      rows.push(...page);
      if (page.length < 500) return rows;
    }
  }
  function validate(fields) {
    fields.forEach(([field]) => field.removeAttribute('aria-invalid'));
    const missing = fields.find(([field]) => !field.value.trim());
    if (missing) {
      missing[0].setAttribute('aria-invalid', 'true');
      missing[0].focus();
      throw new Error(`${missing[1]}${missing[0].tagName === 'SELECT' ? 'を選択' : 'を入力'}してください`);
    }
  }
  return { escape, request, rpc, authorize, all, validate };
})();
