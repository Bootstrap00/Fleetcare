import { useEffect, useState } from 'react';
import { api } from './api';
import { useStore } from './store';
import { Badge, PageHead, Reveal, href, peso } from './ui';

const ACTIVE = ['pending', 'accepted', 'enroute', 'arrived'];
const Tile = ({ to, title, desc }) => <Reveal as="a" className="card tile" href={href(to)}><b>{title}</b><span className="muted">{desc}</span><i>→</i></Reveal>;
const Stats = ({ items }) => <div className="grid g4">{items.map(([v, l], i) => <Reveal key={l} delay={i * 70} className="card stat"><b>{v}</b><span>{l}</span></Reveal>)}</div>;
const first = u => u.name.split(' ')[0];

export function MotoristHome() {
  const { user, rows } = useStore();
  const active = rows.filter(r => ACTIVE.includes(r.status)), done = rows.filter(r => r.status === 'completed');
  const owed = done.filter(r => !r.paid).reduce((s, r) => s + r.support_fee + r.main_fee, 0);
  const cur = active.find(r => r.mechanic_id) || active[0];
  return (
    <div className="page">
      <PageHead eyebrow="Motorist portal" title={`Hi, ${first(user)}`} sub="Need a mechanic? Pin your location and we alert certified mechanics near you."><a className="btn" href={href('/request')}>Request roadside help</a></PageHead>
      <Stats items={[[active.length, 'Active requests'], [done.length, 'Completed jobs'], [peso(owed), 'Balance to pay']]} />
      {cur && <Reveal className="card req"><div className="req-main"><span className="eyebrow">Current request</span><div className="row-top"><b>#{cur.id}</b><Badge s={cur.status} /></div><p>{cur.issue || 'No description'}</p></div>
        <div className="actions"><a className="btn" href={href('/track')}>{cur.mechanic_id ? 'Open live tracking' : 'See status'}</a></div></Reveal>}
      <div className="grid g3"><Tile to="/request" title="Request help" desc="Pin your breakdown and broadcast a distress radius." /><Tile to="/track" title="Live tracking" desc="Follow your mechanic and chat in real time." /><Tile to="/orders" title="My requests" desc="Edit, pay and rate your mechanic." /></div>
    </div>);
}

export function MechanicHome() {
  const { user, rows } = useStore();
  const [me, setMe] = useState(null);
  useEffect(() => { api('/me').then(setMe).catch(() => {}); }, []);
  const open = rows.filter(r => r.status === 'pending'), active = rows.filter(r => r.mechanic_id && ACTIVE.includes(r.status));
  return (
    <div className="page">
      <PageHead eyebrow="Mechanic portal" title={`Hi, ${first(user)}`} sub="Every open request is listed in Jobs, nearest first. Share your location to see distances and get alerts for nearby ones."><a className="btn" href={href('/jobs')}>View jobs</a></PageHead>
      {me && !me.verified && <div className="banner"><b>Awaiting certification.</b> An administrator must certify your account before you can accept jobs.</div>}
      <Stats items={[[open.length, 'Open requests'], [active.length, 'Active jobs'], [me ? peso(me.earned) : '—', 'Earned (paid jobs)'], [me?.rating ? `${me.rating} / 5` : '—', 'Your rating']]} />
      <div className="grid g3"><Tile to="/jobs" title="Jobs" desc="Accept requests, update status and complete jobs." /><Tile to="/track" title="Live job" desc="Map, chat and live location for your current job." /></div>
    </div>);
}

export function AdminHome() {
  const { user } = useStore();
  const [rep, setRep] = useState(null), [users, setUsers] = useState([]);
  useEffect(() => { api('/reports').then(setRep).catch(() => {}); api('/users').then(setUsers).catch(() => {}); }, []);
  const waiting = users.filter(u => u.role === 'mechanic' && !u.verified && !u.deleted_at);
  return (
    <div className="page">
      <PageHead eyebrow="Administrator portal" title={`Hi, ${first(user)}`} sub="Platform overview. Certify mechanics, set fees, edit content and review reports."><a className="btn" href={href('/reports')}>Open reports</a></PageHead>
      <Stats items={[[rep?.totals.requests ?? '—', 'Total requests'], [rep?.totals.active ?? '—', 'Active now'], [rep ? peso(rep.totals.revenue) : '—', 'Revenue (paid)'], [waiting.length, 'Awaiting certification']]} />
      {waiting.length > 0 && <Reveal className="card"><h3>Mechanics awaiting certification</h3>{waiting.slice(0, 5).map(u => <div className="row" key={u.id}><span><b>{u.name}</b> <small className="muted">{u.email}</small></span><a className="btn sm" href={href('/users')}>Review</a></div>)}</Reveal>}
      <div className="grid g3"><Tile to="/orders" title="Requests" desc="All requests, archive and restore." /><Tile to="/users" title="Users and mechanics" desc="Certify, deactivate and reactivate." /><Tile to="/fees" title="Services and fees" desc="Edit the dispatch and severity fees." /><Tile to="/content" title="Website content" desc="Homepage text and announcements." /><Tile to="/reports" title="Reports" desc="KPIs, charts and CSV export." /></div>
    </div>);
}
