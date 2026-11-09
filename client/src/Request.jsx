import { useEffect, useState } from 'react';
import { api, createRequest } from './api';
import { useStore } from './store';
import MapView from './MapView';
import { PageHead, peso, go } from './ui';

const SEV = [['minor', 'Minor', 'Flat tire, jump start, lockout'], ['moderate', 'Moderate', 'Battery, belts, overheating'], ['major', 'Major', 'Engine, transmission, electrical']];
const blank = { issue: '', severity: 'minor', radius_km: 10 };

export default function Request() {
  const { fees, edit, setEdit, setMsg, setSel, load } = useStore();
  const [pin, setPin] = useState(null), [form, setForm] = useState(blank), [busy, setBusy] = useState(false);
  useEffect(() => {
    if (edit) { setForm({ issue: edit.issue || '', severity: edit.severity, radius_km: edit.radius_km }); setPin({ lat: edit.lat, lng: edit.lng }); return; }
    navigator.geolocation?.getCurrentPosition(p => setPin({ lat: p.coords.latitude, lng: p.coords.longitude }), () => setMsg('Location is blocked. Tap the map or type coordinates.'));
  }, [edit]);
  const submit = async () => {
    setBusy(true);
    try {
      if (edit && !edit.resend) { await api('/requests/' + edit.id, { method: 'PATCH', body: { ...pin, ...form } }); setEdit(null); setForm(blank); setMsg('Request updated.'); await load(); return go('/orders'); }
      const r = await createRequest({ ...pin, ...form });
      if (r.queued) setMsg('You are offline. The request is saved and will send when you reconnect.');
      else { setEdit(null); setForm(blank); setMsg(r.notified ? `Distress sent. ${r.notified} nearby mechanic(s) alerted and every mechanic can see it.` : 'Distress sent. No certified mechanic is in range yet, but every mechanic can see your request.'); setSel(r.id); await load(); go('/track'); }
    } catch (e) { setMsg(e.message); } finally { setBusy(false); }
  };
  return (
    <div className="page">
      <PageHead eyebrow="UC-01 · UC-02" title={edit ? (edit.resend ? 'Resend request' : `Edit request #${edit.id}`) : 'Request roadside help'} sub="Pin where you broke down, describe the problem, and choose how far we should search for mechanics." />
      <div className="split">
        <div className="card"><MapView pin={pin} radiusKm={form.radius_km} onPick={setPin} />
          <p className="muted">{pin ? `Pinned at ${pin.lat.toFixed(5)}, ${pin.lng.toFixed(5)}. Tap the map to move the pin.` : 'Finding your location…'}</p></div>
        <div className="card stack">
          <label>What happened?<textarea placeholder="Flat tire, won't start, overheating…" value={form.issue} onChange={e => setForm({ ...form, issue: e.target.value })} /></label>
          <div className="sev">{SEV.map(([k, l, d]) => <button type="button" key={k} className={form.severity === k ? 'on' : ''} onClick={() => setForm({ ...form, severity: k })}><b>{l}</b><small>{d}</small><span>{fees ? peso(fees.main[k]) : ''}</span></button>)}</div>
          <label>Distress radius: <b>{form.radius_km} km</b><input type="range" min="2" max="30" value={form.radius_km} onChange={e => setForm({ ...form, radius_km: +e.target.value })} /></label>
          {fees?.timeout_min && <span className="hint">Unanswered requests expire after {fees.timeout_min} minutes. You can resend with a wider radius.</span>}
          {fees && <div className="fee"><span>Dispatch support {peso(fees.support)} + service {peso(fees.main[form.severity])}</span><b>{peso(fees.support + fees.main[form.severity])}</b></div>}
          <div className="actions">
            <button className="btn" disabled={!pin || busy} onClick={submit}>{edit && !edit.resend ? 'Save changes' : 'Send distress request'}</button>
            {edit && <button className="btn ghost" onClick={() => { setEdit(null); setForm(blank); }}>Cancel edit</button>}
          </div>
        </div>
      </div>
    </div>);
}
