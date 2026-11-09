import { useEffect, useState } from 'react';
import { api } from './api';
import { useStore } from './store';
import { Badge, Empty, PageHead, Reveal, Stars, Who, go, km, peso } from './ui';

export const NEXT = { accepted: ['enroute', 'Start driving'], enroute: ['arrived', "I've arrived"], arrived: ['completed', 'Complete job'] };

export default function Jobs() {
  const { rows, act, setSel, setMsg, load } = useStore();
  const [loc, setLoc] = useState(null);
  const share = () => navigator.geolocation?.getCurrentPosition(async p => {
    const c = { lat: p.coords.latitude, lng: p.coords.longitude };
    try { await api('/me/location', { method: 'PATCH', body: c }); setLoc(c); await load(); } catch (e) { setMsg(e.message); }
  }, () => setMsg('Allow location access to receive jobs near you.'));
  const [me, setMe] = useState(null);
  useEffect(() => { share(); api('/me').then(setMe).catch(() => {}); }, []);
  const open = rows.filter(r => r.status === 'pending').sort((a, b) => (a.distance_km ?? 1e9) - (b.distance_km ?? 1e9)), mine = rows.filter(r => r.mechanic_id);
  return (
    <div className="page">
      <PageHead eyebrow="UC-07 · UC-08 · UC-09" title="Jobs" sub="Every open request appears here instantly, nearest first. Accept one, drive over, and update the status as you go.">
        <button className="btn ghost" onClick={share}>{loc ? 'Location shared · refresh' : 'Share my location'}</button>
      </PageHead>
      {me && !me.verified && <div className="banner"><b>You can view requests, but not accept them yet.</b> An administrator must certify your account first.</div>}
      <h2 className="sub">Open requests</h2>
      {open.length === 0 && <Empty title="No open requests right now">Keep this page open. New requests from any motorist appear here instantly.</Empty>}
      <div className="stack">{open.map(r => (
        <Reveal key={r.id} className="card req">
          <div className="req-main"><div className="row-top"><b>#{r.id}</b><span className="sev-tag">{r.severity}</span><Badge s={r.status} /></div>
            <Who id={r.motorist_id} name={r.motorist_name} at={r.motorist_avatar} />
            <p>{r.issue || 'No description'}</p>
            <small className="muted">{r.distance_km != null ? `~${r.distance_km} km away (${r.in_range ? 'in your range' : 'outside your range'}) · ` : loc ? `~${km(loc, r).toFixed(1)} km away · ` : ''}You earn {peso(r.main_fee)}</small></div>
          <div className="actions"><button className="btn" disabled={me && !me.verified} title={me && !me.verified ? 'Awaiting admin certification' : ''} onClick={() => act.status(r.id, 'accepted')}>Accept job</button></div>
        </Reveal>))}</div>
      <h2 className="sub">My jobs</h2>
      {mine.length === 0 && <Empty title="No jobs yet">Accepted jobs and their history will show here.</Empty>}
      <div className="stack">{mine.map(r => (
        <Reveal key={r.id} className="card req">
          <div className="req-main"><div className="row-top"><b>#{r.id}</b><span className="sev-tag">{r.severity}</span><Badge s={r.status} />{r.paid ? <Badge s="paid" /> : null}</div>
            <Who id={r.motorist_id} name={r.motorist_name} at={r.motorist_avatar} />
            <p>{r.issue || 'No description'}</p>
            <small className="muted">You earn {peso(r.main_fee)}</small>
            {r.my_rating ? <div className="rate">Rated <Stars value={r.my_rating} /></div> : null}</div>
          <div className="actions">
            {NEXT[r.status] && <button className="btn" onClick={() => act.status(r.id, NEXT[r.status][0])}>{NEXT[r.status][1]}</button>}
            <button className="btn ghost sm" onClick={() => { setSel(r.id); go('/track'); }}>Map and chat</button>
          </div>
        </Reveal>))}</div>
    </div>);
}
