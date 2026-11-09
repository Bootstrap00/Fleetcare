// FleetCare service worker: offline shell + cached request list, background sync queue, push.
const CACHE = 'fc-data-v1';
const idb = () => new Promise((ok, no) => { const r = indexedDB.open('fc', 1); r.onupgradeneeded = () => r.result.createObjectStore('q', { autoIncrement: true }); r.onsuccess = () => ok(r.result); r.onerror = no; });
const tx = async (mode, fn) => { const d = await idb(); return new Promise((ok, no) => { const t = d.transaction('q', mode), q = fn(t.objectStore('q')); t.oncomplete = () => ok(q.result); t.onerror = no; }); };

async function flush() {
  const keys = await tx('readonly', s => s.getAllKeys()), vals = await tx('readonly', s => s.getAll());
  for (let i = 0; i < keys.length; i++) {
    try {
      const r = await fetch('/api/requests', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + vals[i].token }, body: JSON.stringify(vals[i].body) });
      if (r.status < 500) await tx('readwrite', s => s.delete(keys[i]));
    } catch { throw new Error('still offline'); } // rejecting makes the browser retry the sync later
  }
}
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.add('/')).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => e.waitUntil(clients.claim()));
self.addEventListener('fetch', e => {
  const { request } = e, url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.startsWith('/api') && !/^\/api\/(requests|config|content|stats|announcements)/.test(url.pathname)) return;
  e.respondWith(fetch(request).then(r => { if (r.ok) { const c = r.clone(); caches.open(CACHE).then(x => x.put(request, c)); } return r; })
    .catch(() => caches.match(request).then(hit => hit || (request.mode === 'navigate' ? caches.match('/') : Response.error()))));
});
self.addEventListener('sync', e => { if (e.tag === 'fc-sync') e.waitUntil(flush()); });
self.addEventListener('message', e => {
  if (e.data?.type === 'queue') e.waitUntil(tx('readwrite', s => s.add({ token: e.data.token, body: e.data.body })));
  if (e.data?.type === 'flush') e.waitUntil(flush().catch(() => {}));
});
self.addEventListener('push', e => { const d = e.data ? e.data.json() : {}; e.waitUntil(self.registration.showNotification(d.title || 'FleetCare', { body: d.body, icon: '/icon.svg' })); });
self.addEventListener('notificationclick', e => { e.notification.close(); e.waitUntil(clients.openWindow('/')); });
