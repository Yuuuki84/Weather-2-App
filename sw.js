// ===== Luna & Elma Service Worker =====
const CACHE_NAME = 'luna-elma-v3';

// TTL 設定（ミリ秒）
const TTL_WEATHER = 10 * 60 * 1000; // 10分
const TTL_NEWS    = 15 * 60 * 1000; // 15分

// プリキャッシュ対象（静的アセット）
const STATIC_ASSETS = [
  './',
  './index.html',
  './app.js',
  './config.js',
  './manifest.json',
  './supabase.js',
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

  // APIリクエスト（天気・AI・ニュース）→ TTL付きキャッシュ戦略
  const isApi =
    url.hostname.includes('openweathermap.org') ||
    url.hostname.includes('googleapis.com') ||
    url.hostname.includes('allorigins.win') ||
    url.hostname.includes('news.yahoo.co.jp') ||
    url.hostname.includes('news.google.com') ||
    url.hostname.includes('rss2json.com');

  if (isApi) {
    event.respondWith(
      caches.open(CACHE_NAME).then(async cache => {
        const cached = await cache.match(event.request);
        if (cached) {
          // TTL チェック
          const cachedDate = cached.headers.get('sw-cache-date');
          if (cachedDate) {
            const age = Date.now() - parseInt(cachedDate, 10);
            const isNews = url.hostname.includes('rss2json.com') ||
                           url.hostname.includes('news.yahoo.co.jp') ||
                           url.hostname.includes('news.google.com');
            const ttl = isNews ? TTL_NEWS : TTL_WEATHER;
            if (age < ttl) {
              return cached; // TTL 内 → キャッシュを返す
            }
          }
        }
        // TTL 切れ or キャッシュなし → ネットワーク取得
        try {
          const netRes = await fetch(event.request);
          if (netRes.ok) {
            // Response は immutable のため arrayBuffer で読み取り再ラップ
            const buf = await netRes.arrayBuffer();
            const headers = new Headers(netRes.headers);
            headers.set('sw-cache-date', String(Date.now()));
            const cloned = new Response(buf, {
              status: netRes.status,
              statusText: netRes.statusText,
              headers,
            });
            cache.put(event.request, cloned.clone());
            return cloned;
          }
          return netRes;
        } catch {
          // ネットワーク失敗 → 古いキャッシュをフォールバック
          return cached || Response.error();
        }
      })
    );
    return;
  }

  // 静的アセット → Stale-While-Revalidate
  // キャッシュを即返しつつ、バックグラウンドで最新を取得してキャッシュ更新
  event.respondWith(
    caches.open(CACHE_NAME).then(async cache => {
      const cached = await cache.match(event.request);
      const networkFetch = fetch(event.request).then(res => {
        if (res.ok) cache.put(event.request, res.clone());
        return res;
      }).catch(() => null);
      // キャッシュがあれば即返す（バックグラウンドで更新）
      // なければネットワーク取得を待つ
      return cached || networkFetch;
    })
  );
});

// ===== Web Push =====
self.addEventListener('push', event => {
  const data = event.data?.json() || {};
  event.waitUntil(
    self.registration.showNotification(data.title || '天気アラート', {
      body: data.body || '',
      icon: './icon-192.svg',
      badge: './icon-192.svg',
      data: { url: data.url || './' }
    })
  );
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(clients.openWindow(event.notification.data?.url || './'));
});
