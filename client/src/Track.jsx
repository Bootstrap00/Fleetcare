import { useEffect, useState } from 'react';
import { subscribe, send } from './socket';
import { useStore } from './store';
import MapView from './MapView';
import Chat from './Chat';
import { RateBox } from './Orders';
import { NEXT } from './Jobs';
import { Badge, Countdown, Empty, PageHead, Who, go, href, km, peso } from './ui';

const STEPS = [['pending', 'Requested'], ['accepted', 'Accepted'], ['enroute', 'On the way'], ['arrived', 'Arrived'], ['completed', 'Completed']];

export default function Track() {
  const { user, rows, sel, setSel, act, setEdit, fees } = useStore();
  const [mech, setMech] = useState(null);
  const list = rows.filter(r => r.mechanic_id && r.status !== 'cancelled');
  const cur = list.find(r => r.id === sel) || list.find(r => r.status !== 'completed') || list[0];
  const waiting = user.role === 'motorist' && !cur && rows.find(r => r.status === 'pending');
  useEffect(() => { setMech(null); }, [cur?.id]);
  useEffect(() => subscribe(m => { if (m.type === 'location' && m.requestId === cur?.id) setMech({ lat: m.lat, lng: m.lng }); }), [cur?.id]);
  useEffect(() => { // the mechanic's phone shares live GPS while heading to the motorist
    if (user.role !== 'mechanic' || !cur || !['accepted', 'enroute'].includes(cur.status)) return;
    const id = navigator.geolocation?.watchPosition(p => send({ type: 'location', requestId: cur.id, lat: p.coords.latitude, lng: p.coords.longitude }), null, { enableHighAccuracy: true });
    return () => { if (id != null) navigator.geolocation.clearWatch(id); };
  }, [cur?.id, cur?.status]);

  const head = <PageHead eyebrow="UC-03" title="Live tracking" sub="Follow the mechanic on the map and chat in real time." />;
  if (waiting) return <div className="page">{head}<div className="card empty"><div className="radar" /><h3>Searching for a mechanic…</h3><p className="muted">Request #{waiting.id} was broadcast within {waiting.radius_km} km and is visible to every mechanic. You will be notified the moment someone accepts.{fees?.timeout_min && <> It expires in <b><Countdown since={waiting.created_at} minutes={fees.timeout_min} /></b> if nobody responds.</>}</p><a className="btn ghost" href={href('/orders')}>View request</a></div></div>;
  const expired = user.role === 'motorist' && !cur && rows.find(r => r.status === 'expired');
  if (expired) return <div className="page">{head}<div className="card empty"><h3>Your request expired</h3><p className="muted">No mechanic accepted request #{expired.id} in time.</p><button className="btn" onClick={() => { setEdit({ ...expired, radius_km: Math.min(30, (expired.radius_km || 10) + 10), resend: true }); go('/request'); }}>Resend with a wider radius</button></div></div>;
  if (!cur) return <div className="page">{head}<Empty title="No active job">{user.role === 'motorist' ? <a className="btn" href={href('/request')}>Request help</a> : <a className="btn" href={href('/jobs')}>Find jobs</a>}</Empty></div>;

  const pos = mech || (cur.mechanic_lat != null ? { lat: cur.mechanic_lat, lng: cur.mechanic_lng } : null);
  const d = pos ? km(pos, cur) : null, at = STEPS.findIndex(s => s[0] === cur.status);
  return (
    <div className="page">
      {head}
      {list.length > 1 && <div className="chips pick">{list.map(r => <button key={r.id} className={'chip' + (r.id === cur.id ? ' on' : '')} onClick={() => setSel(r.id)}>#{r.id} {r.status}</button>)}</div>}
      <ol className="stepper">{STEPS.map(([k, l], i) => <li key={k} className={i < at ? 'done' : i === at ? 'now' : ''}><span>{i + 1}</span>{l}</li>)}</ol>
      <div className="split">
        <div className="card">
          <MapView pin={{ lat: cur.lat, lng: cur.lng }} mechanic={pos} />
          <div className="row-top"><Badge s={cur.status} />{user.role === 'motorist' ? <Who id={cur.mechanic_id} name={cur.mechanic_name} at={cur.mechanic_avatar} rating={cur.mechanic_rating} /> : <Who id={cur.motorist_id} name={cur.motorist_name} at={cur.motorist_avatar} />}{d != null && cur.status !== 'completed' && <b className="eta">~{d.toFixed(1)} km away</b>}</div>
          <p>{cur.issue || 'No description'}</p>
          <div className="actions">
            {user.role === 'mechanic' && NEXT[cur.status] && <button className="btn" onClick={() => act.status(cur.id, NEXT[cur.status][0])}>{NEXT[cur.status][1]}</button>}
            {user.role === 'motorist' && cur.status === 'completed' && !cur.paid && <button className="btn" onClick={() => act.pay(cur.id)}>Pay {peso(cur.support_fee + cur.main_fee)}</button>}
          </div>
          {user.role === 'motorist' && cur.status === 'completed' && <RateBox r={cur} />}
        </div>
        <div className="card"><h3>Chat</h3><Chat requestId={cur.id} me={user.id} /></div>
      </div>
    </div>);
}
