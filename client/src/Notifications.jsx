import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { api, enablePush } from './api';
import { subscribe } from './socket';
import { useStore } from './store';

const ago = d => {
  const s = Math.max(0, (Date.now() - new Date(String(d).replace(' ', 'T') + 'Z').getTime()) / 1000);
  return s < 60 ? 'just now' : s < 3600 ? `${Math.floor(s / 60)} min ago` : s < 86400 ? `${Math.floor(s / 3600)} h ago` : `${Math.floor(s / 86400)} d ago`;
};

// Bell in the navbar: unread count, live updates over WebSocket, list of recent notifications.
export default function NotificationBell() {
  const { setMsg } = useStore();
  const [items, setItems] = useState([]), [unread, setUnread] = useState(0), [open, setOpen] = useState(false);
  const [perm, setPerm] = useState(typeof Notification === 'undefined' ? 'unsupported' : Notification.permission);
  const btn = useRef(), panel = useRef();
  const load = () => api('/notifications').then(d => { setItems(d.items); setUnread(d.unread); }).catch(() => {});
  useEffect(() => { load(); }, []);
  useEffect(() => subscribe(m => {
    if (m.type !== 'notification') return;
    const n = m.notification;
    setItems(x => [n, ...x].slice(0, 30)); setUnread(u => u + 1); setMsg(n.title);
    // desktop alert while this tab is in the background (only needed when background push is not set up)
    if (document.hidden && perm === 'granted' && localStorage.getItem('fc_push') !== '1') new Notification(n.title, { body: n.body, icon: '/icon-192.png' });
  }), [perm]);
  useEffect(() => {
    if (!open) return;
    const out = e => { if (!btn.current?.contains(e.target) && !panel.current?.contains(e.target)) setOpen(false); }, esc = e => e.key === 'Escape' && setOpen(false);
    addEventListener('mousedown', out); addEventListener('keydown', esc);
    return () => { removeEventListener('mousedown', out); removeEventListener('keydown', esc); };
  }, [open]);

  const markRead = ids => api('/notifications/read', { method: 'POST', body: ids ? { ids } : {} }).catch(() => {});
  const openItem = n => {
    if (!n.read) { markRead([n.id]); setItems(x => x.map(i => i.id === n.id ? { ...i, read: 1 } : i)); setUnread(u => Math.max(0, u - 1)); }
    setOpen(false); location.hash = '#' + n.link;
  };
  const readAll = () => { markRead(); setItems(x => x.map(i => ({ ...i, read: 1 }))); setUnread(0); };
  const enable = async () => {
    try { await enablePush(); localStorage.setItem('fc_push', '1'); setMsg('Push notifications are on. You will get alerts even when FleetCare is closed.'); }
    catch (e) {
      if (/not configured/.test(e.message) && 'Notification' in window) { // no VAPID keys on the server: still allow alerts while the app is open
        const p = await Notification.requestPermission();
        setMsg(p === 'granted' ? 'Browser alerts are on while FleetCare is open. Add VAPID keys on the server for background push.' : 'Notifications were blocked in your browser settings.');
      } else setMsg(e.message);
    } finally { if (typeof Notification !== 'undefined') setPerm(Notification.permission); }
  };
  // Permission can be granted before the device is registered for background push (for example, granted while the server had no keys).
  // Register it silently whenever permission is granted, so the test button and real alerts reach this device even when the app is closed.
  useEffect(() => { if (perm === 'granted') enablePush().then(() => localStorage.setItem('fc_push', '1')).catch(() => {}); }, [perm]);
  const test = async () => { try { await enablePush(); localStorage.setItem('fc_push', '1'); } catch {} api('/push/test', { method: 'POST' }).catch(e => setMsg(e.message)); };

  return (<>
    <button ref={btn} className="bell-btn" aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`} aria-expanded={open} onClick={() => setOpen(!open)}>
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" /></svg>
      {unread > 0 && <span className="bell-count">{unread > 9 ? '9+' : unread}</span>}
    </button>
    {open && createPortal(
      <div ref={panel} className="notif-panel" role="dialog" aria-label="Notifications">
        <div className="notif-head"><b>Notifications</b>{unread > 0 && <button className="btn ghost sm" onClick={readAll}>Mark all read</button>}</div>
        <div className="notif-list">{items.length === 0 ? <p className="muted pad">No notifications yet.</p> : items.map(n => (
          <button key={n.id} className={'notif' + (n.read ? '' : ' unread')} onClick={() => openItem(n)}><b>{n.title}</b>{n.body ? <span>{n.body}</span> : null}<small>{ago(n.created_at)}</small></button>))}</div>
        <div className="notif-foot">
          {perm === 'unsupported' ? <small className="muted">This browser does not support notifications.</small>
            : perm === 'granted' ? <><small className="muted">Browser notifications are on</small><button className="btn ghost sm" onClick={test}>Send test</button></>
            : perm === 'denied' ? <small className="muted">Notifications are blocked. Allow them in your browser's site settings.</small>
            : <button className="btn sm" onClick={enable}>Enable browser notifications</button>}
        </div>
      </div>, document.body)}
  </>);
}
