import { useRef, useState } from 'react';
import { api } from './api';
import { resizeImage } from './images';
import { PhotoGrid } from './Photos';
import { PayStatus, PaymentActions } from './Payments';
import { useStore } from './store';
import { Badge, Empty, PageHead, Reveal, Stars, Who, Countdown, go, href, peso } from './ui';

export function RateBox({ r }) {
  const { load, setMsg } = useStore();
  const [stars, setStars] = useState(0), [comment, setComment] = useState(''), [files, setFiles] = useState([]), [busy, setBusy] = useState(false);
  const pick = useRef();
  const ids = r.review_photo_ids ? String(r.review_photo_ids).split(',').map(Number) : [];
  const room = 4 - ids.length - (r.my_rating ? 0 : files.length); // once reviewed, only saved photos count
  const guard = fn => async (...a) => { setBusy(true); try { await fn(...a); } catch (e) { setMsg(e.message); } finally { setBusy(false); } };

  const choose = guard(async e => {
    const picked = [...e.target.files].slice(0, Math.max(0, room)); e.target.value = '';
    const next = []; for (const f of picked) next.push({ name: f.name, data: await resizeImage(f) });
    if (r.my_rating) { for (const f of next) await api(`/requests/${r.id}/review-photos`, { method: 'POST', body: { image: f.data } }); await load(); setMsg('Photos added.'); }
    else setFiles(x => [...x, ...next]);
  });
  const submit = guard(async () => {
    await api(`/requests/${r.id}/rate`, { method: 'POST', body: { stars, comment } });
    try { for (const f of files) await api(`/requests/${r.id}/review-photos`, { method: 'POST', body: { image: f.data } }); setMsg('Thanks for your review!'); }
    catch (e) { setMsg('Review saved, but a photo failed: ' + e.message); }
    setFiles([]); await load();
  });
  const del = guard(async id => { await api('/photos/' + id, { method: 'DELETE' }); await load(); });
  const picker = <><input ref={pick} type="file" accept="image/*" multiple hidden onChange={choose} />
    {room > 0 && <button type="button" className="btn ghost sm" disabled={busy} onClick={() => pick.current.click()}>{r.my_rating ? 'Add photos' : 'Add photos of the work'} ({room} left)</button>}</>;

  if (r.my_rating) return (
    <div className="review stack"><div>You reviewed {r.mechanic_name} <Stars value={r.my_rating} /></div>
      {r.my_comment ? <p>“{r.my_comment}”</p> : null}
      <PhotoGrid photos={ids} onDelete={del} />{picker}</div>);
  return (
    <div className="review stack"><b>Review {r.mechanic_name}'s work</b>
      <Stars value={stars} onPick={setStars} />
      <textarea placeholder="Tell others about the service (optional)" maxLength={500} value={comment} onChange={e => setComment(e.target.value)} />
      {files.length > 0 && <div className="thumbs">{files.map((f, i) => <span className="thumb" key={i}><img src={f.data} alt={f.name} /><button type="button" className="x" aria-label="Remove photo" onClick={() => setFiles(files.filter((_, j) => j !== i))}>×</button></span>)}</div>}
      {picker}
      <button className="btn sm" disabled={!stars || busy} onClick={submit}>{busy ? 'Submitting…' : 'Submit review'}</button></div>);
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
            <div className="row-top"><b>#{r.id}</b><span className="sev-tag">{r.severity}</span><Badge s={r.status} /><PayStatus r={r} /></div>
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
            {!arch && <PaymentActions r={r} user={user} />}
            {arch ? <button className="btn ghost sm" onClick={() => act.restore(r.id)}>Restore</button> : <button className="btn ghost sm" onClick={() => act.archive(r.id)}>Archive</button>}
          </div>
        </Reveal>))}</div>
    </div>);
}
