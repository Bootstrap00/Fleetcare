import { useEffect, useState } from 'react';
import { api } from './api';
import { useStore } from './store';
import { peso } from './ui';

export const METHOD_LABEL = { cash: 'Cash on Service', gcash: 'GCash', maya: 'Maya', card: 'Credit / Debit Card', bank: 'Bank Transfer' };

// Payment status of a booking: Pending | Paid | Failed (+ the method once one was chosen)
export function PayStatus({ r }) {
  if (r.status !== 'completed' && !r.payment_method) return null;
  const label = { paid: 'Paid', failed: 'Failed', pending: 'Pending' }[r.payment_status] || 'Pending';
  return <span className={'badge pay-' + (r.payment_status || 'pending')} title="Payment status">Payment: {label}{r.payment_method ? ` · ${METHOD_LABEL[r.payment_method]}` : ''}</span>;
}

// Buttons for whoever has to act on a payment: the motorist pays/cancels, the mechanic (or admin) confirms.
export function PaymentActions({ r, user }) {
  const { setPaying, load, setMsg } = useStore();
  const call = (path, body) => api(path, { method: 'POST', body }).then(() => load()).catch(e => setMsg(e.message));
  if (r.status !== 'completed' || r.paid) return null;
  const waiting = r.payment_status === 'pending' && r.payment_method && r.payment_id;
  if (user.role === 'motorist' && r.payment_online && r.payment_status === 'pending') return (
    <div className="pay-wait"><span className="muted">Waiting for your {METHOD_LABEL[r.payment_method]} payment to go through…</span>
      <div className="actions">{r.payment_url && <a className="btn sm" href={r.payment_url}>Continue to {METHOD_LABEL[r.payment_method]}</a>}
        <button className="btn ghost sm" onClick={() => call(`/requests/${r.id}/confirm`, { pid: r.payment_id })}>Check payment</button>
        <button className="btn ghost sm" onClick={() => call(`/payments/${r.payment_id}/cancel`)}>Cancel</button></div></div>);
  if (user.role === 'motorist') return waiting
    ? <><span className="muted">Waiting for {r.mechanic_name || 'your mechanic'} to confirm{r.payment_reference ? ` · ref ${r.payment_reference}` : ''}</span><button className="btn ghost sm" onClick={() => call(`/payments/${r.payment_id}/cancel`)}>Cancel payment</button></>
    : <button className="btn sm" onClick={() => setPaying(r)}>{r.payment_status === 'failed' ? 'Try another method' : 'Pay'} {peso(r.support_fee + r.main_fee)}</button>;
  if (waiting && !r.payment_online) return (
    <div className="stack payconfirm"><small className="muted">{METHOD_LABEL[r.payment_method]} {peso(r.support_fee + r.main_fee)}{r.payment_reference ? ` · reference ${r.payment_reference}` : ''}</small>
      <div className="actions"><button className="btn sm" onClick={() => call(`/payments/${r.payment_id}/confirm`, { paid: true })}>Confirm received</button><button className="btn danger sm" onClick={() => call(`/payments/${r.payment_id}/confirm`, { paid: false })}>Mark failed</button></div></div>);
  return null;
}

// Payment dialog: pick a method, follow its instructions, submit.
export default function PayDialog() {
  const { paying: r, setPaying, load, setMsg } = useStore();
  const [opts, setOpts] = useState(null), [method, setMethod] = useState(''), [ref, setRef] = useState(''), [err, setErr] = useState(''), [busy, setBusy] = useState(false);
  useEffect(() => { if (!r) return; setMethod(''); setRef(''); setErr(''); api('/payment-options').then(setOpts).catch(e => setErr(e.message)); }, [r?.id]);
  useEffect(() => { if (!r) return; const k = e => e.key === 'Escape' && setPaying(null); addEventListener('keydown', k); return () => removeEventListener('keydown', k); }, [r]);
  if (!r) return null;
  const m = opts?.methods.find(x => x.id === method), total = r.support_fee + r.main_fee;
  const submit = async () => {
    setBusy(true); setErr('');
    try {
      const out = await api(`/requests/${r.id}/pay`, { method: 'POST', body: { method, reference: ref } });
      if (out.url) { location.href = out.url; return; } // provider checkout: GCash / Maya app or card page
      setMsg(`Payment submitted. We told your mechanic to confirm your ${METHOD_LABEL[method]} payment.`);
      await load(); setPaying(null);
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Pay for service" onClick={() => setPaying(null)}>
      <div className="card stack modal-box" onClick={e => e.stopPropagation()}>
        <div className="row-top"><h3>Pay for request #{r.id}</h3><button className="btn ghost sm" aria-label="Close" onClick={() => setPaying(null)}>Close</button></div>
        <div className="fee"><span>Dispatch support {peso(r.support_fee)} + service {peso(r.main_fee)}</span><b>{peso(total)}</b></div>
        {!opts ? <p className="muted">Loading payment options…</p> : <>
          <div className="paygrid" role="radiogroup" aria-label="Payment method">{opts.methods.map(o => (
            <label key={o.id} className={'paymethod' + (method === o.id ? ' on' : '')}><input type="radio" name="paymethod" value={o.id} checked={method === o.id} onChange={() => { setMethod(o.id); setErr(''); }} /><b>{o.label}</b></label>))}</div>
          {m && <div className="stack payinfo">
            <p>{m.hint}</p>
            {m.details && <dl className="acct">{m.details.bank && <><dt>Bank</dt><dd>{m.details.bank}</dd></>}<dt>Account name</dt><dd>{m.details.name}</dd><dt>{m.id === 'bank' ? 'Account number' : 'Number'}</dt><dd>{m.details.number}</dd><dt>Amount</dt><dd>{peso(total)}</dd></dl>}
            {m.needs_reference && <label>Reference number<input value={ref} placeholder="From your payment receipt" maxLength={40} onChange={e => setRef(e.target.value)} /></label>}
          </div>}
          {err && <p className="error">{err}</p>}
          <button className="btn" disabled={!method || busy || (m?.needs_reference && ref.trim().length < 6)} onClick={submit}>{busy ? 'Working…' : m?.online ? `Pay ${peso(total)} with ${m.label}` : m?.id === 'cash' ? 'Choose Cash on Service' : 'Submit payment'}</button></>}
      </div>
    </div>);
}
