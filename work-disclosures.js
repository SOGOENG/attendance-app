// Display only: keep existing form controls and their event handlers intact.
(() => {
  for (const id of ['workPanel', 'balancePanel']) {
    document.getElementById(id)?.addEventListener('invalid', event => {
      const section = event.target.closest('.work-disclosure');
      if (section) section.open = true;
    }, true);
  }
  const panel = document.getElementById('workPanel');
  if (!panel) return;
  panel.addEventListener('click', event => {
    if (!event.target.closest('.edit-work')) return;
    document.getElementById('workBalanceSection').open = true;
    document.getElementById('workRegistrationSection').open = true;
  });
})();
