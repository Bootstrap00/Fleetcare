export const token = () => localStorage.getItem('fc_token');
export const setSession = (t, u) => { localStorage.setItem('fc_token', t); localStorage.setItem('fc_user', JSON.stringify(u)); };
export const clearSession = () => { localStorage.removeItem('fc_token'); localStorage.removeItem('fc_user'); };

export async function api(path, opts = {}) {
  const r = await fetch('/api' + path, {
    ...opts, body: opts.body ? JSON.stringify(opts.body) : undefined,
    headers: { 'Content-Type': 'application/json', ...(token() ? { Authorization: 'Bearer ' + token() } : {}) }
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(data.error || 'Something went wrong'), { data, status: r.status });
  return data;
}

// Offline-first: when offline the request is handed to the service worker, which retries via Background Sync.
export async function createRequest(body) {
  if (navigator.onLine) return api('/requests', { method: 'POST', body });
  const reg = await navigator.serviceWorker.ready;
  reg.active.postMessage({ type: 'queue', token: token(), body });
  try { await reg.sync.register('fc-sync'); }
  catch { addEventListener('online', () => reg.active.postMessage({ type: 'flush' }), { once: true }); }
  return { queued: true };
}

const b64 = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
export async function enablePush() {
  const { key } = await api('/push/key');
  if (!key || !('PushManager' in window)) throw new Error('Push notifications are not configured on the server');
  if (await Notification.requestPermission() !== 'granted') throw new Error('Notification permission was denied');
  const reg = await navigator.serviceWorker.ready;
  const sub = (await reg.pushManager.getSubscription()) || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(key) });
  await api('/push/subscribe', { method: 'POST', body: sub.toJSON() });
}
