import { useEffect, useState } from 'react';
import { api, token } from './api';
import { useStore } from './store';
import { Avatar, Badge, Empty, PageHead, Reveal, Stars, peso } from './ui';

export function Users() {
  const { setMsg } = useStore();
  const [list, setList] = useState([]), [tab, setTab] = useState('all'), [q, setQ] = useState('');
  const refresh = () => api('/users').then(setList).catch(e => setMsg(e.message));
  useEffect(() => { refresh(); }, []);
  const patch = (path, body) => api(path, { method: 'PATCH', body }).then(refresh).catch(e => setMsg(e.message));
  const shown = list.filter(u => u.role !== 'admin' && (tab === 'all' || u.role === tab) && (u.name + u.email).toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="page">
      <PageHead eyebrow="UC-10" title="Users and mechanics" sub="Certify mechanics before they can accept jobs, or deactivate accounts." />
      <div className="toolbar"><div className="seg">{['all', 'mechanic', 'motorist'].map(t => <button key={t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>{t}</button>)}</div>
        <input placeholder="Search name or email" value={q} onChange={e => setQ(e.target.value)} /></div>
      {shown.length === 0 && <Empty title="No users found" />}
      <div className="stack">{shown.map(u => (
        <Reveal key={u.id} className="card req">
          <div className="req-main"><div className="row-top"><Avatar id={u.id} name={u.name} at={u.avatar_at} size={34} /><b>{u.name}</b><span className="sev-tag">{u.role}</span>
            {u.deleted_at ? <Badge s="cancelled" /> : u.role === 'mechanic' ? <Badge s={u.verified ? 'completed' : 'pending'} /> : null}</div>
            <small className="muted">{u.email}{u.phone ? ` · ${u.phone}` : ''}{u.role === 'mechanic' ? ` · ${u.jobs} jobs` : ''}</small>
            {u.role === 'mechanic' && u.rating ? <div className="rate"><Stars value={Math.round(u.rating)} /> {u.rating}</div> : null}</div>
          <div className="actions">
            {u.role === 'mechanic' && !u.deleted_at && <button className={'btn sm' + (u.verified ? ' ghost' : '')} onClick={() => patch(`/users/${u.id}/verify`, { verified: !u.verified })}>{u.verified ? 'Revoke certification' : 'Certify'}</button>}
            <button className="btn danger sm" onClick={() => patch(`/users/${u.id}/active`, { active: !!u.deleted_at })}>{u.deleted_at ? 'Reactivate' : 'Deactivate'}</button>
          </div>
        </Reveal>))}</div>
    </div>);
}

export function Fees() {
  const { setMsg } = useStore();
  const [f, setF] = useState(null);
  useEffect(() => { api('/config').then(c => setF({ support: c.support, ...c.main })); }, []);
  const save = () => api('/fees', { method: 'PUT', body: f }).then(() => setMsg('Fees saved. New requests use these amounts.')).catch(e => setMsg(e.message));
  const rows = [['support', 'Dispatch support fee (per phone dispatch)'], ['minor', 'Minor issue'], ['moderate', 'Moderate issue'], ['major', 'Major issue']];
  return (
    <div className="page narrow">
      <PageHead eyebrow="UC-11" title="Services and fees" sub="Whole pesos. Changes apply to new requests only." />
      <div className="card stack">{f ? rows.map(([k, l]) => <label key={k}>{l}<input type="number" min="0" step="1" value={f[k]} onChange={e => setF({ ...f, [k]: e.target.value })} /></label>) : <p className="muted">Loading…</p>}
        {f && <><div className="fee"><span>Example: minor job total</span><b>{peso(+f.support + +f.minor)}</b></div><button className="btn" onClick={save}>Save fees</button></>}</div>
    </div>);
}

export function Content() {
  const { setMsg } = useStore();
  const [c, setC] = useState(null), [news, setNews] = useState([]), [n, setN] = useState({ title: '', body: '' });
  const refresh = () => api('/admin/announcements').then(setNews).catch(() => {});
  useEffect(() => { api('/content').then(setC); refresh(); }, []);
  const saveC = () => api('/content', { method: 'PUT', body: c }).then(() => setMsg('Website content saved.')).catch(e => setMsg(e.message));
  const call = (m, path, body) => api(path, { method: m, body }).then(refresh).catch(e => setMsg(e.message));
  return (
    <div className="page">
      <PageHead eyebrow="UC-12" title="Website content" sub="Edit the homepage text and publish announcements shown on the home page." />
      <div className="split">
        <div className="card stack"><h3>Homepage</h3>
          {c && <><label>Headline<input value={c.hero_title} onChange={e => setC({ ...c, hero_title: e.target.value })} /></label>
            <label>Subheading<textarea value={c.hero_sub} onChange={e => setC({ ...c, hero_sub: e.target.value })} /></label>
            <label>Button label<input value={c.cta_label} onChange={e => setC({ ...c, cta_label: e.target.value })} /></label>
            <button className="btn" onClick={saveC}>Save homepage</button></>}</div>
        <div className="card stack"><h3>Announcements</h3>
          <input placeholder="Title" value={n.title} onChange={e => setN({ ...n, title: e.target.value })} />
          <input placeholder="Message" value={n.body} onChange={e => setN({ ...n, body: e.target.value })} />
          <button className="btn sm" disabled={!n.title} onClick={() => call('POST', '/admin/announcements', n).then(() => setN({ title: '', body: '' }))}>Publish</button>
          {news.map(a => <div className="row" key={a.id}><div><b>{a.title}</b><br /><small className="muted">{a.body}</small></div>
            <div className="actions"><button className="btn ghost sm" onClick={() => call('PATCH', '/admin/announcements/' + a.id, { published: !a.published })}>{a.published ? 'Unpublish' : 'Publish'}</button>
              <button className="btn danger sm" onClick={() => call('DELETE', '/admin/announcements/' + a.id)}>Delete</button></div></div>)}</div>
      </div>
    </div>);
}

export function Reports() {
  const { setMsg } = useStore();
  const [d, setD] = useState(null);
  useEffect(() => { api('/reports').then(setD).catch(e => setMsg(e.message)); }, []);
  const csv = async () => {
    const r = await fetch('/api/reports.csv', { headers: { Authorization: 'Bearer ' + token() } });
    const a = document.createElement('a'); a.href = URL.createObjectURL(await r.blob()); a.download = 'fleetcare-report.csv'; a.click(); URL.revokeObjectURL(a.href);
  };
  const head = <PageHead eyebrow="UC-13" title="Reports" sub="Platform performance at a glance."><button className="btn" onClick={csv}>Export CSV</button></PageHead>;
  if (!d) return <div className="page">{head}<Empty title="Loading report…" /></div>;
  const t = d.totals, max = Math.max(1, ...d.daily.map(x => x.count)), maxS = Math.max(1, ...d.bySeverity.map(x => x.count));
  const kpis = [['Total requests', t.requests], ['Active now', t.active], ['Completed', t.completed], ['Expired (no mechanic)', t.expired], ['Revenue (paid)', peso(t.revenue)], ['Outstanding', peso(t.outstanding)], ['Average rating', d.rating.avg ? `${d.rating.avg} (${d.rating.count})` : '—'], ['Mechanics', `${d.users.certified} / ${d.users.mechanics} certified`], ['Motorists', d.users.motorists]];
  return (
    <div className="page">{head}
      <div className="grid g4">{kpis.map(([l, v], i) => <Reveal key={l} delay={i * 50} className="card stat"><b>{v}</b><span>{l}</span></Reveal>)}</div>
      <div className="split">
        <div className="card"><h3>Requests, last 7 days</h3>{d.daily.length === 0 ? <p className="muted">No requests yet.</p> :
          <div className="bars">{d.daily.map(x => <div className="bar" key={x.day}><span>{x.count}</span><i style={{ height: Math.max(6, x.count / max * 120) }} /><small>{x.day.slice(5)}</small></div>)}</div>}</div>
        <div className="card"><h3>By severity</h3>{d.bySeverity.length === 0 ? <p className="muted">No data yet.</p> : d.bySeverity.map(x =>
          <div className="meter" key={x.severity}><div><b>{x.severity}</b><span className="muted"> {x.count} requests · {peso(x.revenue)}</span></div><i style={{ width: x.count / maxS * 100 + '%' }} /></div>)}</div>
      </div>
      <div className="card"><h3>Top mechanics</h3>{d.mechanics.length === 0 ? <p className="muted">No mechanics yet.</p> : d.mechanics.map(m =>
        <div className="row" key={m.name}><b>{m.name}</b><span className="muted">{m.jobs} jobs · {m.rating ? '★' + m.rating : 'unrated'} · {peso(m.earned)} earned</span></div>)}</div>
    </div>);
}
