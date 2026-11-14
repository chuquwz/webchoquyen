const CACHE_NAME = 'quyenhealth-v51';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/style.css?v=51',
  '/app.js?v=51',
  '/manifest.webmanifest',
  '/icons/icon-192.png?v=31',
  '/icons/icon-512.png?v=31'
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS)).catch(() => {})
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) return caches.delete(key);
        })
      )
    ).then(() => self.clients.claim()).then(() => {
      // Báo hiệu cho toàn bộ client tab đang mở tự reload để nạp giao diện mới nhất ngay lập tức
      return self.clients.matchAll({ type: 'window' }).then((clients) => {
        clients.forEach((client) => {
          client.postMessage({ type: 'FORCE_RELOAD' });
        });
      });
    })
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  // Không chặn và không cache API
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/healthz')) {
    return;
  }
  // Chiến lược Network First: Luôn tải từ máy chủ để người dùng nhận ngay bản mới, chỉ fallback cache khi offline
  event.respondWith(
    fetch(event.request).then((resp) => {
      if (resp.status === 200 && event.request.method === 'GET') {
        const clone = resp.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
      }
      return resp;
    }).catch(() => caches.match(event.request).then((cached) => cached || caches.match('/index.html')))
  );
});

// Xử lý thông điệp từ trang
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// Xử lý Web Push Notification (Tương thích chuẩn Apple APNs iOS 16.4+ & Android)
self.addEventListener('push', (event) => {
  let data = { title: 'QuyenHealth', body: 'Bạn có lời nhắc sức khoẻ mới!', url: '/' };
  try {
    if (event.data) {
      data = Object.assign(data, event.data.json());
    }
  } catch (e) {
    if (event.data) data.body = event.data.text();
  }

  const options = {
    body: data.body || '',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    data: { url: data.url || '/' }
  };

  event.waitUntil(
    Promise.all([
      self.registration.showNotification(data.title || 'QuyenHealth', options).catch((err) => {
        console.error('showNotification error:', err);
      }),
      self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
        for (let client of windowClients) {
          client.postMessage({
            type: 'PUSH_RECEIVED',
            title: data.title || 'QuyenHealth',
            body: data.body || ''
          });
        }
      }).catch(() => {})
    ])
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      for (let client of windowClients) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.navigate(targetUrl);
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })
  );
});
