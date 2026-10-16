/* Opening/returning to the home page acknowledges all device-local notifications.
   Keep this independent of home.js's approval-pending badge and Push subscription. */
(() => {
  async function clearHomeNotificationBadge() {
    if (document.visibilityState !== "visible") return;
    try {
      if ("serviceWorker" in navigator) {
        const registration = await navigator.serviceWorker.ready;
        if (document.visibilityState === "visible") {
          (navigator.serviceWorker.controller || registration.active)?.postMessage({
            type: "CLEAR_NOTIFICATION_BADGE"
          });
        }
      } else if (typeof navigator.clearAppBadge === "function") {
        await navigator.clearAppBadge();
      }
    } catch (_) { /* Unsupported/denied APIs must not interfere with the portal. */ }
  }
  window.addEventListener("pageshow", clearHomeNotificationBadge);
  document.addEventListener("visibilitychange", clearHomeNotificationBadge);
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.addEventListener("controllerchange", clearHomeNotificationBadge);
  }
  clearHomeNotificationBadge();
})();
