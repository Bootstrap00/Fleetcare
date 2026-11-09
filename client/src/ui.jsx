import { useEffect, useRef, useState } from 'react';
const role = () => { try { return JSON.parse(localStorage.getItem('fc_user'))?.role || null; } catch { return null; } };
// Portal pages live under /motorist, /mechanic or /admin. '/dashboard' is the portal home.
export const path = p => (p === '/' || p.startsWith('/login') || !role() ? p : `/${role()}${p === '/dashboard' ? '' : p}`);
export const href = p => '#' + path(p);
export const go = p => { location.hash = path(p); };
export const peso = n => '₱' + Number(n ?? 0).toLocaleString();
export const km = (a, b) => { const r = x => x * Math.PI / 180, h = Math.sin(r(b.lat - a.lat) / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lng - a.lng) / 2) ** 2; return 12742 * Math.asin(Math.sqrt(h)); };

export function useHash() {
  const get = () => location.hash.replace(/^#/, '') || '/';
  const [h, setH] = useState(get);
  useEffect(() => { const f = () => { setH(get()); scrollTo(0, 0); }; addEventListener('hashchange', f); return () => removeEventListener('hashchange', f); }, []);
  return h;
}
export function useCursorGlow() {
  useEffect(() => {
    const f = e => { const s = document.documentElement.style; s.setProperty('--mx', e.clientX + 'px'); s.setProperty('--my', e.clientY + 'px'); };
    addEventListener('pointermove', f); return () => removeEventListener('pointermove', f);
  }, []);
}
export function Reveal({ as: T = 'div', delay = 0, className = '', children, ...p }) {
  const ref = useRef(), [on, setOn] = useState(false);
  useEffect(() => {
    if (!('IntersectionObserver' in window)) return setOn(true);
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setOn(true); io.disconnect(); } }, { threshold: 0.1 });
    io.observe(ref.current); return () => io.disconnect();
  }, []);
  return <T ref={ref} className={`reveal ${on ? 'in' : ''} ${className}`} style={{ transitionDelay: delay + 'ms' }} {...p}>{children}</T>;
}
export const Stars = ({ value = 0, onPick }) => (
  <span className="stars" role="img" aria-label={`${value} of 5 stars`}>
    {[1, 2, 3, 4, 5].map(n => <button key={n} type="button" className={n <= value ? 'on' : ''} disabled={!onPick} onClick={() => onPick?.(n)}>★</button>)}
  </span>);
export function Avatar({ id, name = '?', at, size = 36 }) {
  const [bad, setBad] = useState(false);
  const initials = name.trim().split(/\s+/).slice(0, 2).map(w => w[0]?.toUpperCase()).join('') || '?';
  return (<span className="avatar" style={{ width: size, height: size, fontSize: size * 0.4 }}>
    {at && !bad ? <img src={`/api/users/${id}/avatar?v=${at}`} alt={name} onError={() => setBad(true)} /> : initials}</span>);
}
export const Who = ({ id, name, at, rating }) => name ? <div className="who"><Avatar id={id} name={name} at={at} size={28} />{name}{rating ? <span className="muted"> ★{rating}</span> : null}</div> : null;
// mm:ss until a pending request expires
export function Countdown({ since, minutes }) {
  const end = new Date(String(since).replace(' ', 'T') + 'Z').getTime() + minutes * 60000;
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const s = Math.max(0, Math.round((end - now) / 1000));
  return <span className="countdown">{Math.floor(s / 60)}:{String(s % 60).padStart(2, '0')}</span>;
}
export const Badge = ({ s }) => <span className={'badge ' + s}>{s}</span>;
export const PageHead = ({ eyebrow, title, sub, children }) => (
  <header className="page-head"><div><span className="eyebrow">{eyebrow}</span><h1>{title}</h1>{sub && <p className="lead">{sub}</p>}</div>{children}</header>);
export const Empty = ({ title, children }) => <div className="card empty"><div className="radar" /><h3>{title}</h3>{children}</div>;
