import { useState } from 'react';
import NotificationBell from './Notifications';
import { Avatar, path } from './ui';
import { LogoMark, Wordmark } from './Logo';

export default function Nav({ user, route, items, onLogout }) {
  const [open, setOpen] = useState(false);
  const link = ([p, l]) => { const to = path(p); return <a key={p} href={'#' + to} className={route === to ? 'on' : ''} onClick={() => setOpen(false)}>{l}</a>; };
  return (<>
    <nav className="nav" aria-label="Main">
      <div className="logo-wrap"><a className="logo" href="#/" aria-label="FleetCare home"><LogoMark size={42} /><Wordmark /></a>{user && <span className="tag">{user.role} portal</span>}</div>
      <div className="links">{items.map(link)}</div>
      <div className="nav-end">
        {user && <NotificationBell />}
        {user && <a className={'me-link' + (route === path('/profile') ? ' on' : '')} href={'#' + path('/profile')} title="My profile"><Avatar id={user.id} name={user.name} at={user.avatar_at} size={32} /><span className="nm">{user.name.split(' ')[0]}</span></a>}
        {user ? <button className="btn ghost sm" onClick={onLogout}>Log out</button> : <a className="btn sm" href="#/login">Get started</a>}
        <button className={'burger' + (open ? ' open' : '')} aria-label="Menu" aria-expanded={open} onClick={() => setOpen(!open)}><span /><span /></button>
      </div>
    </nav>
    {open && <div className="drawer" onClick={() => setOpen(false)}>{items.map(link)}{user && link(['/profile', 'My profile'])}{user && <small>{user.name} · {user.role} portal</small>}{user && <button className="btn drawer-out" onClick={onLogout}>Log out</button>}</div>}
  </>);
}
