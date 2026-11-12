import { useEffect, useState } from 'react';
import { api } from './api';
import { useStore } from './store';
import { Badge, PageHead, Reveal, href, peso } from './ui';

const ACTIVE = ['pending', 'accepted', 'enroute', 'arrived'];
const Tile = ({ to, title, desc }) => <Reveal as="a" className="card tile" href={href(to)}><b>{title}</b><span className="muted">{desc}</span><i>→</i></Reveal>;
const Stats = ({ items }) => <div className="summary-grid">{items.map(([v, l], i) => <Reveal key={l} delay={i * 70} className="card stat"><b>{v}</b><span>{l}</span></Reveal>)}</div>;
const first = u => u.name.split(' ')[0];
const statusMeta = {
  pending: 'Waiting for acceptance',
  accepted: 'Mechanic assigned',
  enroute: 'On the way',
  arrived: 'At your location',
  completed: 'Completed',
  expired: 'Expired',
};

export function MotoristHome() {
  const { user, rows } = useStore();
  const active = rows.filter(r => ACTIVE.includes(r.status)), done = rows.filter(r => r.status === 'completed');
  const owed = done.filter(r => !r.paid).reduce((s, r) => s + r.support_fee + r.main_fee, 0);
  const cur = active.find(r => r.mechanic_id) || active[0];
  const recentSteps = [
    'Pin your location and describe the issue.',
    'Nearest certified mechanics receive the alert.',
    'Track the assigned mechanic and chat live.',
    'Pay securely and leave a quick rating.'
  ];
  return (
    <div className="page portal-page">
      <header className="card portal-hero motorist-hero">
        <div>
          <span className="eyebrow">Motorist portal</span>
          <h1>Hi, {first(user)}</h1>
          <p className="lead">Need a mechanic? Pin your location and we alert certified mechanics near you.</p>
        </div>
        <div className="portal-actions">
          <a className="btn" href={href('/request')}>Request roadside help</a>
          <a className="btn ghost" href={href('/track')}>Open live tracking</a>
        </div>
      </header>

      <Stats items={[[active.length, 'Active requests'], [done.length, 'Completed jobs'], [peso(owed), 'Balance to pay']]} />

      {cur && <Reveal className="card dashboard-highlight">
        <div className="highlight-header">
          <div>
            <span className="eyebrow">Current request</span>
            <div className="row-top"><b>#{cur.id}</b><Badge s={cur.status} /></div>
          </div>
          <span className="status-note">{statusMeta[cur.status] || 'In progress'}</span>
        </div>
        <p>{cur.issue || 'No description'}</p>
        <div className="actions"><a className="btn" href={href('/track')}>{cur.mechanic_id ? 'Open live tracking' : 'See status'}</a></div>
      </Reveal>}

      <div className="portal-layout">
        <div className="portal-stack">
          <Reveal className="card">
            <h3>Quick actions</h3>
            <div className="mini-actions">
              <a href={href('/request')} className="mini-action"><span>Request help</span><strong>New breakdown</strong></a>
              <a href={href('/track')} className="mini-action"><span>Live tracking</span><strong>Follow arrival</strong></a>
              <a href={href('/orders')} className="mini-action"><span>My requests</span><strong>View history</strong></a>
            </div>
          </Reveal>
          <Reveal className="card">
            <h3>What happens next</h3>
            <ol className="timeline">{recentSteps.map((step, i) => <li key={step}><span>{String(i + 1).padStart(2, '0')}</span><p>{step}</p></li>)}</ol>
          </Reveal>
        </div>
        <Reveal className="card side-panel">
          <h3>Service snapshot</h3>
          <div className="side-list">
            <div><small>Dispatch fee</small><strong>₱150</strong></div>
            <div><small>Average response</small><strong>3 min</strong></div>
            <div><small>Verified mechanics</small><strong>{Math.max(1, active.length || 28)}</strong></div>
          </div>
        </Reveal>
      </div>

      <div className="grid g3"><Tile to="/request" title="Request help" desc="Pin your breakdown and broadcast a distress radius." /><Tile to="/track" title="Live tracking" desc="Follow your mechanic and chat in real time." /><Tile to="/orders" title="My requests" desc="Edit, pay and rate your mechanic." /></div>
    </div>);
}

export function MechanicHome() {
  const { user, rows } = useStore();
  const [me, setMe] = useState(null);
  useEffect(() => { api('/me').then(setMe).catch(() => {}); }, []);
  const open = rows.filter(r => r.status === 'pending'), active = rows.filter(r => r.mechanic_id && ACTIVE.includes(r.status));
  const nextSteps = [
    'Review nearby open requests in Jobs.',
    'Accept the best-fit call and head to the pickup.',
    'Update the service status as you progress.',
    'Complete the job and collect your payout.'
  ];
  return (
    <div className="page portal-page">
      <header className="card portal-hero mechanic-hero">
        <div>
          <span className="eyebrow">Mechanic portal</span>
          <h1>Hi, {first(user)}</h1>
          <p className="lead">Every open request is listed in Jobs, nearest first. Share your location to see distances and get alerts for nearby ones.</p>
        </div>
        <div className="portal-actions"><a className="btn" href={href('/jobs')}>View jobs</a></div>
      </header>

      {me && !me.verified && <div className="banner"><b>Awaiting certification.</b> An administrator must certify your account before you can accept jobs.</div>}
      <Stats items={[[open.length, 'Open requests'], [active.length, 'Active jobs'], [me ? peso(me.earned) : '—', 'Earned (paid jobs)'], [me?.rating ? `${me.rating} / 5` : '—', 'Your rating']]} />

      <div className="portal-layout">
        <div className="portal-stack">
          <Reveal className="card">
            <h3>Priority board</h3>
            <div className="mini-actions compact">
              <a href={href('/jobs')} className="mini-action"><span>Jobs</span><strong>{open.length} open</strong></a>
              <a href={href('/track')} className="mini-action"><span>Live job</span><strong>{active.length} active</strong></a>
            </div>
          </Reveal>
          <Reveal className="card">
            <h3>On-the-road flow</h3>
            <ol className="timeline">{nextSteps.map((step, i) => <li key={step}><span>{String(i + 1).padStart(2, '0')}</span><p>{step}</p></li>)}</ol>
          </Reveal>
        </div>
        <Reveal className="card side-panel">
          <h3>Performance</h3>
          <div className="side-list">
            <div><small>Verified status</small><strong>{me?.verified ? 'Certified' : 'Pending'}</strong></div>
            <div><small>Total earnings</small><strong>{me ? peso(me.earned) : '—'}</strong></div>
            <div><small>Current rating</small><strong>{me?.rating ? `${me.rating}/5` : '—'}</strong></div>
          </div>
        </Reveal>
      </div>

      <div className="grid g3"><Tile to="/jobs" title="Jobs" desc="Accept requests, update status and complete jobs." /><Tile to="/track" title="Live job" desc="Map, chat and live location for your current job." /></div>
    </div>);
}

export function AdminHome() {
  const { user } = useStore();
  const [rep, setRep] = useState(null), [users, setUsers] = useState([]);
  useEffect(() => { api('/reports').then(setRep).catch(() => {}); api('/users').then(setUsers).catch(() => {}); }, []);
  const waiting = users.filter(u => u.role === 'mechanic' && !u.verified && !u.deleted_at);
  const adminSteps = [
    'Review new mechanic applications and verify credentials.',
    'Monitor request volume and service performance in real time.',
    'Adjust fees and content to keep pricing consistent.',
    'Export reports and identify operational gaps.'
  ];
  return (
    <div className="page portal-page">
      <header className="card portal-hero admin-hero">
        <div>
          <span className="eyebrow">Administrator portal</span>
          <h1>Hi, {first(user)}</h1>
          <p className="lead">Platform overview. Certify mechanics, set fees, edit content and review reports.</p>
        </div>
        <div className="portal-actions"><a className="btn" href={href('/reports')}>Open reports</a></div>
      </header>

      <Stats items={[[rep?.totals.requests ?? '—', 'Total requests'], [rep?.totals.active ?? '—', 'Active now'], [rep ? peso(rep.totals.revenue) : '—', 'Revenue (paid)'], [waiting.length, 'Awaiting certification']]} />

      {waiting.length > 0 && <Reveal className="card"><h3>Mechanics awaiting certification</h3>{waiting.slice(0, 5).map(u => <div className="row" key={u.id}><span><b>{u.name}</b> <small className="muted">{u.email}</small></span><a className="btn sm" href={href('/users')}>Review</a></div>)}</Reveal>}

      <div className="portal-layout">
        <div className="portal-stack">
          <Reveal className="card">
            <h3>Operations</h3>
            <div className="mini-actions compact">
              <a href={href('/orders')} className="mini-action"><span>Requests</span><strong>Track all</strong></a>
              <a href={href('/users')} className="mini-action"><span>Users</span><strong>{waiting.length} pending</strong></a>
              <a href={href('/fees')} className="mini-action"><span>Fees</span><strong>Update</strong></a>
            </div>
          </Reveal>
          <Reveal className="card">
            <h3>Operational flow</h3>
            <ol className="timeline">{adminSteps.map((step, i) => <li key={step}><span>{String(i + 1).padStart(2, '0')}</span><p>{step}</p></li>)}</ol>
          </Reveal>
        </div>
        <Reveal className="card side-panel">
          <h3>Operations snapshot</h3>
          <div className="side-list">
            <div><small>Open requests</small><strong>{rep?.totals.active ?? '—'}</strong></div>
            <div><small>Revenue</small><strong>{rep ? peso(rep.totals.revenue) : '—'}</strong></div>
            <div><small>Pending approvals</small><strong>{waiting.length}</strong></div>
          </div>
        </Reveal>
      </div>

      <div className="grid g3"><Tile to="/orders" title="Requests" desc="All requests, archive and restore." /><Tile to="/users" title="Users and mechanics" desc="Certify, deactivate and reactivate." /><Tile to="/fees" title="Services and fees" desc="Edit the dispatch and severity fees." /><Tile to="/content" title="Website content" desc="Homepage text and announcements." /><Tile to="/reports" title="Reports" desc="KPIs, charts and CSV export." /></div>
    </div>);
}
