/* =========================================
   Staff Portal Service Worker
========================================= */

const CACHE_NAME =
  "staff-portal-v95";

const CACHE_FILES = [
  "./site-admin.html",
  "./client-admin.html",
  "./site-admin.js?v=2",
  "./client-admin.js?v=1",
  "./master-admin-common.js?v=1",
  "./master-admin.css?v=1",
  "./tool-inspection-workflow.js?v=1",
  "./tool-inspection-registration.js?v=1",
  "./tool-catalog-admin.js?v=1",
  "./shared-tool-state.js?v=1",
  "./",
  "./login.html",
  "./home.html",
  "./index.html",
  "./improvement.html",
  "./near-miss.html",
  "./my-page.html",
  "./applications.html",
  "./applications-admin.html",
  "./application-print.html",
  "./tool-checkout.html",
  "./tool-qr.html",
  "./shared-tools.html",
  "./settings.html?v=2",
  "./help.html",
  "./schedule.html",
  "./admin.html",
  "./attendance-admin.html",
  "./improvement-admin.html",
  "./near-miss-admin.html",
  "./style.css",
  "./style.css?v=26",
  "./style.css?v=29",
  "./style.css?v=30",
  "./attendance-application-sync.css?v=1",
  "./applications.css?v=2",
  "./applications.css?v=3",
  "./applications.css?v=4",
  "./applications-comp.css?v=2",
  "./application-print.css?v=4",
  "./application-print-approval.css?v=1",
  "./portal-auth.js",
  "./push-notifications.js",
  "./notification-badge.js?v=1",
  "./login.js",
  "./home.js?v=8",
  "./app.js?v=13",
  "./improvement.js",
  "./near-miss.js?v=1",
  "./my-page.js?v=5",
  "./applications.js?v=11",
  "./application-result-badge.js?v=1",
  "./application-result-badge.css?v=1",
  "./applications-admin.js?v=17",
  "./application-print.js?v=4",
  "./tool-employees.js?v=1",
  "./tool-checkout.js?v=5",
  "./tool-qr.js?v=16",
  "./shared-tools.js?v=17",
  "./settings.js",
  "./schedule.js",
  "./admin.js",
  "./attendance-admin.js?v=4",
  "./improvement-admin.js",
  "./near-miss-admin.js",
  "./side-menu.css?v=1",
  "./side-menu.css?v=2",
  "./side-menu.js?v=1",
  "./side-menu.js?v=2",
  "./manifest.json",
  "./icons/se-icon-192.png",
  "./icons/se-icon-512.png",
  "./icons/se-icon-512-maskable.png",
  "./icons/se-apple-touch-icon.png"
];


/* =========================================
   インストール
========================================= */

self.addEventListener(
  "install",
  event => {
    event.waitUntil(
      caches
        .open(CACHE_NAME)
        .then(cache =>
          cache.addAll(CACHE_FILES)
        )
    );

    self.skipWaiting();
  }
);


/* =========================================
   古いキャッシュを削除
========================================= */

self.addEventListener(
  "activate",
  event => {
    event.waitUntil(
      caches
        .keys()
        .then(cacheNames =>
          Promise.all(
            cacheNames
              .filter(
                cacheName =>
                  cacheName !== CACHE_NAME
              )
              .map(
                cacheName =>
                  caches.delete(cacheName)
              )
          )
        )
    );

    self.clients.claim();
  }
);


/* =========================================
   通信処理
========================================= */

self.addEventListener(
  "fetch",
  event => {
    const request =
      event.request;

    const requestUrl =
      new URL(request.url);

    /*
      GET以外はキャッシュしない
    */

    if (request.method !== "GET") {
      return;
    }

    /*
      SupabaseやGoogleなど、
      外部通信はService Workerで触らない
    */

    if (
      requestUrl.origin !==
      self.location.origin
    ) {
      return;
    }

    /*
      HTMLページはネットを優先する
      更新があればすぐ反映する
    */

    if (
      request.mode === "navigate"
    ) {
      event.respondWith(
        fetch(request)
          .then(response => {
            const copy =
              response.clone();

            caches
              .open(CACHE_NAME)
              .then(cache =>
                cache.put(request, copy)
              );

            return response;
          })
          .catch(() =>
            caches.match(request)
          )
      );

      return;
    }

    /*
      CSS・JS・画像はキャッシュを優先し、
      ボタン操作後の表示を速くする
    */

    event.respondWith(
      caches
        .match(request)
        .then(cachedResponse => {
          if (cachedResponse) {
            return cachedResponse;
          }

          return fetch(request)
            .then(response => {
              const copy =
                response.clone();

              caches
                .open(CACHE_NAME)
                .then(cache =>
                  cache.put(
                    request,
                    copy
                  )
                );

              return response;
            });
        })
    );
  }
);

/* Device-local unread count. Only this worker writes it; pages send a message.
   IndexedDB survives worker restarts and cache upgrades. Serialize storage AND
   badge calls so overlapping push/click/home events cannot lose increments. */
let notificationBadgeQueue = Promise.resolve();

function storeNotificationBadgeCount(clear) {
  return new Promise((resolve, reject) => {
    const request = self.indexedDB.open("staff-portal-notification-badge", 1);
    let expired = false;
    let transaction;
    const timer = setTimeout(() => {
      expired = true;
      try { transaction?.abort(); } catch (_) { /* Already completed. */ }
      reject(new Error("Notification badge storage timed out"));
    }, 3000);
    const fail = error => { clearTimeout(timer); reject(error); };
    request.onupgradeneeded = () => request.result.createObjectStore("state");
    request.onerror = () => fail(request.error);
    request.onblocked = () => {
      expired = true;
      fail(new Error("Notification badge storage blocked"));
    };
    request.onsuccess = () => {
      const db = request.result;
      if (expired) { db.close(); return; }
      try {
        transaction = db.transaction("state", "readwrite");
        const store = transaction.objectStore("state");
        const read = store.get("unread");
        let count = 0;
        read.onsuccess = () => {
          const previous = Number.isSafeInteger(read.result) && read.result >= 0 ? read.result : 0;
          count = clear ? 0 : Math.min(previous + 1, Number.MAX_SAFE_INTEGER);
          store.put(count, "unread");
        };
        transaction.oncomplete = () => { clearTimeout(timer); db.close(); resolve(count); };
        transaction.onabort = () => { db.close(); fail(transaction.error); };
      } catch (error) { db.close(); fail(error); }
    };
  });
}

async function applyNotificationBadge(count) {
  const api = self.navigator;
  try {
    if (count === 0 && typeof api?.clearAppBadge === "function") {
      await api.clearAppBadge();
    } else if (typeof api?.setAppBadge === "function") {
      await api.setAppBadge(count);
    }
  } catch (_) { /* Badging must never prevent notification delivery/navigation. */ }
}

function updateNotificationBadge(clear = false) {
  notificationBadgeQueue = notificationBadgeQueue.then(async () => {
    try {
      await applyNotificationBadge(await storeNotificationBadgeCount(clear));
    } catch (_) {
      // Storage may be unavailable. Do not invent an inaccurate unread count.
      if (clear) await applyNotificationBadge(0);
    }
  }).catch(() => {});
  return notificationBadgeQueue;
}

self.addEventListener("message", event => {
  if (event.data?.type !== "CLEAR_NOTIFICATION_BADGE") return;
  // Accept only messages from this app's home page.
  try {
    const home = new URL("./home.html", self.registration.scope);
    const source = new URL(event.source.url);
    if (source.origin !== home.origin || source.pathname !== home.pathname) return;
  } catch (_) { return; }
  event.waitUntil(updateNotificationBadge(true));
});

/* =========================================
   Push通知受信
========================================= */

self.addEventListener(
  "push",
  event => {
    let data = {};

    try {
      data = event.data
        ? event.data.json()
        : {};
    } catch (error) {
      data = {
        title: "工事部ポータル",
        body: event.data
          ? event.data.text()
          : "新しい通知があります"
      };
    }

    const title =
      data.title ||
      "工事部ポータル";

    const options = {
      body:
        data.body ||
        "新しい通知があります",

      icon:
        "./icons/se-icon-192.png",

      badge:
        "./icons/se-icon-192.png",

      data: {
        url:
          data.url ||
          "./home.html"
      }
    };

    event.waitUntil(
      Promise.all([updateNotificationBadge(), self.registration
        .showNotification(
          title,
          options
        )])
    );
  }
);


/* =========================================
   通知タップ
========================================= */

self.addEventListener(
  "notificationclick",
  event => {
    event.notification.close();

    const url =
      event.notification
        .data?.url ||
      "./home.html";

    event.waitUntil(
      Promise.all([updateNotificationBadge(true), clients.matchAll({
        type: "window",
        includeUncontrolled: true
      })
        .then(async clientList => {
          const target = new URL(url, self.registration.scope);
          for (
            const client of clientList
          ) {
            if (
              "focus" in client &&
              new URL(client.url).origin === target.origin
            ) {
              if (client.url === target.href) return client.focus();
              if ("navigate" in client) {
                try {
                  const navigated = await client.navigate(target.href);
                  if (navigated) return navigated.focus();
                } catch (_) { /* Fall back to opening the notification URL. */ }
              }
            }
          }

          if (
            clients.openWindow
          ) {
            return clients.openWindow(
              url
            );
          }
        })])
    );
  }
);
