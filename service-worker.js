/* =========================================
   Staff Portal Service Worker
========================================= */

const CACHE_NAME =
  "staff-portal-v31";

const CACHE_FILES = [
  "./",
  "./login.html",
  "./home.html",
  "./index.html",
  "./improvement.html",
  "./near-miss.html",
  "./settings.html?v=2",
  "./help.html",
  "./schedule.html",
  "./admin.html",
  "./attendance-admin.html",
  "./improvement-admin.html",
  "./near-miss-admin.html",
  "./style.css",
  "./portal-auth.js",
  "./push-notifications.js",
  "./login.js",
  "./home.js",
  "./app.js",
  "./improvement.js",
  "./near-miss.js",
  "./settings.js",
  "./schedule.js",
  "./admin.js",
  "./attendance-admin.js",
  "./improvement-admin.js",
  "./near-miss-admin.js",
  "./side-menu.css?v=1",
  "./side-menu.js?v=1",
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
      self.registration
        .showNotification(
          title,
          options
        )
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
      clients.matchAll({
        type: "window",
        includeUncontrolled: true
      })
        .then(clientList => {
          for (
            const client of clientList
          ) {
            if (
              "focus" in client
            ) {
              return client.focus();
            }
          }

          if (
            clients.openWindow
          ) {
            return clients.openWindow(
              url
            );
          }
        })
    );
  }
);
