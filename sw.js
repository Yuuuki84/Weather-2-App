// ===== Luna & Elma Service Worker =====
const CACHE_NAME = 'luna-elma-v1';

// プリキャッシュ対象（静的アセット）
const STATIC_ASSETS = [
  './',
  './index.html',
  './app.js',
  './config.js',
  './manifest.json',
];

// インストール時：静的アセットをキャッシュ
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

// アクティベート時：古いキャッシュを削除
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// フェッチ処理
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // APIリクエスト（天気・AI・ニュース）→ ネットワーク優先、失敗時はキャッシュ
  const isApi =
    url.hostname.includes('openweathermap.org') ||
    url.hostname.includes('googleapis.com') ||
    url.hostname.includes('allorigins.win') ||
    url.hostname.includes('news.yahoo.co.jp') ||
    url.hostname.includes('news.google.com');

  if (isApi) {
    event.respondWith(
      fetch(event.request)
        .then(res => {
          // 成功レスポンスをキャッシュに保存
          if (res.ok) {
            const clone = res.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          }
          return res;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // 静的アセット → キャッシュ優先、なければネットワーク取得してキャッシュ保存
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(res => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return res;
      });
    })
  );
});
