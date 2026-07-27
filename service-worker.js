/* =========================================
   Staff Portal Service Worker
========================================= */

const CACHE_NAME =
  "staff-portal-v6";

const CACHE_FILES = [
  "./",
  "./login.html",
  "./home.html",
  "./index.html",
  "./improvement.html",
  "./near-miss.html",
  "./schedule.html",
  "./admin.html",
  "./attendance-admin.html",
  "./improvement-admin.html",
  "./near-miss-admin.html",
  "./style.css",
  "./portal-auth.js",
  "./login.js",
  "./home.js",
  "./app.js",
  "./improvement.js",
  "./near-miss.js",
  "./schedule.js",
  "./admin.js",
  "./attendance-admin.js",
  "./improvement-admin.js",
  "./near-miss-admin.js",
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