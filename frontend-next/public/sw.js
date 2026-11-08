self.addEventListener('push', (event) => {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch {
    payload = { title: 'SKEMA', body: event.data.text(), url: '/dashboard' };
  }

  const title = payload.title || 'SKEMA';
  const options = {
    body: payload.body || '',
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    data: { url: payload.url || '/dashboard' },
    vibrate: [200, 100, 200],
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const path = event.notification.data?.url || '/dashboard';
  const target = new URL(path, self.location.origin).href;
  // 이미 열린 SKEMA 창이 있으면 그 창을 알림이 가리키는 화면(예: 그날 하루 타임라인)으로 옮긴다.
  // 주소가 조금만 달라도(?view=week 등) 새 창을 열던 문제를 막는다. 옮길 수 없으면 새 창을 연다.
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (clientList) => {
      for (const client of clientList) {
        if (client.url === target && 'focus' in client) return client.focus();
      }
      for (const client of clientList) {
        if (!client.url.startsWith(self.location.origin) || !('navigate' in client)) continue;
        try {
          const moved = await client.navigate(target);
          return (moved || client).focus();
        } catch {
          // 이 서비스워커가 관리하지 않는 창이면 navigate가 실패한다. 다음 창 또는 새 창으로.
        }
      }
      if (clients.openWindow) return clients.openWindow(target);
    })
  );
});

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(clients.claim()));
