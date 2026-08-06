'use strict';

const CACHE_NAME = 'ninja-schedule-player-v10-1-0';

self.addEventListener('install', event => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', () => {
  // v10.1では更新トラブル防止のためキャッシュ介入を行いません。
});
