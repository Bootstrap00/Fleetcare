import { useEffect, useState } from 'react';
import { clearSession, setSession, token } from './api';
import { connect, disconnect } from './socket';
import { Store, useStore } from './store';
import { go, useCursorGlow, useHash } from './ui';
import Nav from './Nav';
import Landing from './Landing';
import Auth from './Auth';
import Request from './Request';
import Track from './Track';
import Orders from './Orders';
import Jobs from './Jobs';
import { MotoristHome, MechanicHome, AdminHome } from './Portal';
import { Users, Fees, Content, Reports } from './Admin';
import Profile from './Profile';
import Reset from './Reset';
import { LogoMark, Wordmark } from './Logo';

// Nav keys are portal-relative; ui.path() prefixes them with the signed-in role (/motorist, /mechanic, /admin).
const NAV = {
  guest: [['/', 'Home'], ['/login/motorist', 'Motorist'], ['/login/mechanic', 'Mechanic'], ['/login/admin', 'Admin']],
  motorist: [['/dashboard', 'Dashboard'], ['/request', 'Request help'], ['/track', 'Live tracking'], ['/orders', 'My requests']],
  mechanic: [['/dashboard', 'Dashboard'], ['/jobs', 'Jobs'], ['/track', 'Live job']],
  admin: [['/dashboard', 'Dashboard'], ['/orders', 'Requests'], ['/users', 'Users'], ['/fees', 'Services and fees'], ['/content', 'Content'], ['/reports', 'Reports']],
};
const PORTAL = {
  motorist: { '': MotoristHome, request: Request, track: Track, orders: Orders, profile: Profile },
  mechanic: { '': MechanicHome, jobs: Jobs, track: Track, profile: Profile },
  admin: { '': AdminHome, orders: Orders, users: Users, fees: Fees, content: Content, reports: Reports, profile: Profile },
};
const ROLES = Object.keys(PORTAL);

// Decide what to show for a route, or where to redirect. Each role can only ever see its own portal.
export function resolve(route, user) {
  const [seg, ...rest] = route.split('/').filter(Boolean);
  if (!seg) return { page: Landing, path: '/' };
  if (seg === 'reset') return { page: Reset, props: { token: rest[0] }, path: route };
  if (seg === 'login') {
    if (user) return { redirect: `/${user.role}` };
    return rest[0] && !ROLES.includes(rest[0]) ? { redirect: '/login' } : { page: Auth, props: { portal: rest[0] }, path: route };
  }
  if (ROLES.includes(seg)) {
    if (!user) return { redirect: `/login/${seg}` };
    if (user.role !== seg) return { redirect: `/${user.role}` };
    const page = PORTAL[seg][rest[0] || ''];
    return page ? { page, path: route } : { redirect: `/${seg}` };
  }
  return { redirect: '/' };
}

function Toast() { const { msg, setMsg } = useStore(); return msg ? <div className="toast" role="status" onClick={() => setMsg('')}>{msg}</div> : null; }

export default function App() {
  const [user, setUser] = useState(() => JSON.parse(localStorage.getItem('fc_user') || 'null'));
  const route = useHash();
  useCursorGlow();
  useEffect(() => { if (user) connect(); }, [user]);
  const r = resolve(route, user);
  useEffect(() => { if (r.redirect && route !== r.redirect) location.replace('#' + r.redirect); }, [route, user]);
  useEffect(() => { document.documentElement.dataset.role = user?.role || (route.startsWith('/login/') ? route.split('/')[2] : ''); }, [user, route]);
  const Page = r.page || (user ? PORTAL[user.role][''] : Landing);
  const updateUser = (u, t) => { setSession(t || token(), u); setUser(u); };
  const logout = () => { disconnect(); clearSession(); caches?.delete('fc-data-v1'); setUser(null); go('/'); };
  const body = (<>
    <Nav user={user} route={r.path || route} items={NAV[user?.role || 'guest']} onLogout={logout} />
    <main key={r.path || route}><Page {...r.props} user={user} onAuth={u => { setUser(u); go('/dashboard'); }} /></main>
    <footer><span className="foot-brand"><LogoMark size={26} /><Wordmark /></span><span>Multi-tier mechanic and roadside assistance platform</span></footer>
    {user && <Toast />}
  </>);
  return user ? <Store user={user} updateUser={updateUser}>{body}</Store> : body;
}
