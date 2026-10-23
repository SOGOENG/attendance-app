(() => {
  'use strict';

  const menu = document.getElementById('drivingAdminMenu');
  if (!menu) return;
  const message = document.getElementById('drivingAdminMessage');
  const retry = document.getElementById('retryDrivingAdminAccess');
  const timeoutMs = 8000;

  async function checkAccess(path, body, allowed) {
    const controller = new AbortController();
    let timer;
    try {
      // Bound the whole check, including token refresh and response parsing.
      return await Promise.race([
        (async () => {
          const response = await portalFetch(`${PORTAL_SUPABASE_URL}${path}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal: controller.signal
          });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          return allowed(await response.json());
        })(),
        new Promise((_, reject) => {
          timer = setTimeout(() => { controller.abort(); reject(new Error('timeout')); }, timeoutMs);
        })
      ]);
    } catch (error) {
      // Do not log tokens, response bodies, or employee information.
      console.warn('Driving admin menu: authorization check failed', path,
        error?.name === 'AbortError' ? 'timeout' : error?.message);
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  function render(admin, receipts) {
    for (const link of menu.querySelectorAll('[data-driving-access]')) {
      link.hidden = link.dataset.drivingAccess === 'admin' ? !admin : !(admin || receipts);
    }
    menu.hidden = !admin && !receipts;
  }

  // Full administrators must not depend on the receipt Edge Function responding.
  // Both checks still use the destination screens' server authorization.
  async function showMenus() {
    render(false, false);
    if (retry) { retry.disabled = true; retry.hidden = true; }
    if (message) { message.hidden = false; message.textContent = '運転日報管理の権限を確認しています…'; }
    let failed = false;
    try {
      const admin = await checkAccess('/rest/v1/rpc/is_application_admin', {}, value => value === true);
      if (admin) {
        render(true, true);
        if (message) message.hidden = true;
        return;
      }
    } catch { failed = true; }
    try {
      const receipts = await checkAccess('/functions/v1/fuel-receipts', { action: 'access', data: {} },
        value => value?.manager === true);
      render(false, receipts);
    } catch { failed = true; }
    finally {
      if (message) {
        message.hidden = !failed;
        message.textContent = failed ? '運転日報管理の権限を確認できませんでした。通信状況とログイン状態を確認して再試行してください。' : '';
      }
      if (retry) { retry.hidden = !failed; retry.disabled = false; }
    }
  }

  if (retry) retry.onclick = showMenus;
  showMenus();
})();
