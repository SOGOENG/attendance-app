/* Server-backed result acknowledgement, separate from the device Push badge. */
(() => {
  async function rpc(name, body = {}) {
    const response = await portalFetch(`${PORTAL_SUPABASE_URL}/rest/v1/rpc/${name}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body)
    });
    if (!response.ok) throw new Error("申請結果の未確認情報を取得・更新できませんでした");
    return response.status === 204 ? null : response.json();
  }
  let displayed = [], pending = false;
  async function acknowledge() {
    if (pending || !displayed.length || document.visibilityState !== "visible" ||
        document.getElementById("historyPanel")?.hidden !== false) return;
    const snapshot = displayed;
    pending = true;
    try {
      await rpc("mark_application_results_read", { p_history_ids: snapshot });
      displayed = displayed.filter(id => !snapshot.includes(id));
    } catch (error) { console.warn(error.message); }
    finally { pending = false; }
  }
  window.applicationResults = {
    async snapshot() {
      try { return await rpc("get_unread_application_results"); }
      catch (error) { console.warn(error.message); return []; }
    },
    rendered(apps, results) {
      displayed = results.filter(result => apps.some(app =>
        String(app.id) === String(result.application_id) && app.status === result.result_status
      )).map(result => result.history_id);
      acknowledge();
    },
    acknowledge
  };
  let requestId = 0;
  async function refresh() {
    const badge = document.getElementById("applicationResultBadge");
    if (!badge || document.visibilityState !== "visible") return;
    const current = ++requestId;
    try {
      const rows = await rpc("get_unread_application_results");
      if (current !== requestId) return;
      badge.textContent = rows.length ? String(rows.length) : "";
      badge.hidden = !rows.length;
      badge.setAttribute("aria-label", `未確認の申請結果${rows.length}件`);
    } catch (error) { console.warn(error.message); }
  }
  const resume = () => { refresh(); acknowledge(); };
  window.addEventListener("pageshow", resume);
  document.addEventListener("visibilitychange", resume);
  refresh();
})();
