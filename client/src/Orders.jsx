import { useState } from 'react';
import { useStore } from './store';
import { Badge, Empty, PageHead, Reveal, Stars, Who, Countdown, go, href, peso } from './ui';

export function RateBox({ r }) {
  const { act } = useStore();
  const [stars, setStars] = useState(0), [comment, setComment] = useState('');
  if (r.my_rating) return <div className="rate">You rated {r.mechanic_name} <Stars value={r.my_rating} /></div>;
  return (<div className="rate stack"><b>Rate {r.mechanic_name}</b><Stars value={stars} onPick={setStars} />
    <input placeholder="Optional comment" value={comment} onChange={e => setComment(e.target.value)} />
    <button className="btn sm" disabled={!stars} onClick={() => act.rate(r.id, stars, comment)}>Submit rating</button></div>);
}

export default function Orders() {
  const { user, rows, arch, setArch, act, setEdit, setSel, fees } = useStore();
  const mot = user.role === 'motorist';
  return (
    <div className="page">
      <PageHead eyebrow={mot ? 'UC-04 · UC-05' : 'Administrator'} title={mot ? 'My requests' : 'All requests'} sub={mot ? 'Edit pending requests, pay completed jobs and rate your mechanic.' : 'Every request on the platform. Archive or restore as needed.'}>
        <label className="toggle"><input type="checkbox" checked={arch} onChange={e => setArch(e.target.checked)} /> Show archived</label>
      </PageHead>
      {rows.length === 0 && <Empty title={arch ? 'Nothing archived' : 'No requests yet'}>{mot && !arch && <a className="btn" href={href('/request')}>Request help</a>}</Empty>}
      <div className="stack">{rows.map(r => (
        <Reveal key={r.id} className="card req">
          <div className="req-main">
            <div className="row-top"><b>#{r.id}</b><span className="sev-tag">{r.severity}</span><Badge s={r.status} />{r.paid ? <Badge s="paid" /> : null}</div>
            {!mot && <Who id={r.motorist_id} name={r.motorist_name} at={r.motorist_avatar} />}<Who id={r.mechanic_id} name={r.mechanic_name} at={r.mechanic_avatar} rating={r.mechanic_rating} />
            <p>{r.issue || 'No description'}</p>
            <small className="muted">{peso(r.support_fee + r.main_fee)} (support {peso(r.support_fee)} + service {peso(r.main_fee)})</small>
            {r.status === 'pending' && fees?.timeout_min && <small className="muted">Expires in <Countdown since={r.created_at} minutes={fees.timeout_min} /> if no mechanic accepts.</small>}
            {r.status === 'expired' && <small className="muted">No mechanic accepted in time. Resend with a wider radius.</small>}
            {mot && r.status === 'completed' && <RateBox r={r} />}
          </div>
          <div className="actions">
            {!arch && mot && r.mechanic_id && r.status !== 'cancelled' && <button className="btn ghost sm" onClick={() => { setSel(r.id); go('/track'); }}>Track</button>}
            {!arch && mot && r.status === 'pending' && <button className="btn ghost sm" onClick={() => { setEdit(r); go('/request'); }}>Edit</button>}
            {!arch && mot && r.status === 'expired' && <button className="btn sm" onClick={() => { setEdit({ ...r, radius_km: Math.min(30, (r.radius_km || 10) + 10), resend: true }); go('/request'); }}>Resend</button>}
            {!arch && mot && ['pending', 'accepted'].includes(r.status) && <button className="btn danger sm" onClick={() => act.status(r.id, 'cancelled')}>Cancel</button>}
            {mot && r.status === 'completed' && !r.paid && <button className="btn sm" onClick={() => act.pay(r.id)}>Pay {peso(r.support_fee + r.main_fee)}</button>}
            {arch ? <button className="btn ghost sm" onClick={() => act.restore(r.id)}>Restore</button> : <button className="btn ghost sm" onClick={() => act.archive(r.id)}>Archive</button>}
          </div>
        </Reveal>))}</div>
    </div>);
}
