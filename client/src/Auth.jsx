import { useEffect, useState } from 'react';
import { api, setSession } from './api';
import { PageHead, Reveal } from './ui';
import { BrandRow } from './Logo';

export const PORTALS = {
  motorist: ['Motorist', 'Request roadside help, track your mechanic and pay securely.'],
  mechanic: ['Mechanic', 'Receive nearby jobs, update their status and build your rating.'],
  admin: ['Administrator', 'Manage users, fees, content and reports. Staff only.'],
};

export default function Auth({ portal, onAuth }) {
  const [mode, setMode] = useState('login'), [f, setF] = useState({}), [err, setErr] = useState('');
  const [lock, setLock] = useState(0), [sent, setSent] = useState(null), [busy, setBusy] = useState(false);
  useEffect(() => { if (lock <= 0) return; const t = setTimeout(() => setLock(l => l - 1), 1000); return () => clearTimeout(t); }, [lock]);
  useEffect(() => { if (lock === 0 && /Too many/.test(err)) setErr(''); }, [lock]);

  if (!portal) return (
    <div className="page auth-page">
      <div className="auth-landing card">
        <div className="auth-landing-copy">
          <BrandRow />
          <PageHead eyebrow="UC-06" title="Choose your portal" sub="Each role has its own secure workspace and service flow." />
        </div>
        <div className="auth-grid chooser">{Object.entries(PORTALS).map(([k, [t, d]], i) =>
          <Reveal as="a" key={k} delay={i * 80} className="card tile" data-role={k} style={{ '--accent-rgb': { motorist: '255,184,0', mechanic: '61,220,151', admin: '177,140,255' }[k] }} href={'#/login/' + k}><b>{t} portal</b><span className="muted">{d}</span><i>→</i></Reveal>)}</div>
      </div>
    </div>);

  const [title] = PORTALS[portal], canRegister = portal !== 'admin', forgot = mode === 'forgot';
  const set = k => e => setF({ ...f, [k]: e.target.value });
  const switchMode = m => { setMode(m); setErr(''); setSent(null); };
  const submit = async () => {
    setBusy(true); setErr('');
    try {
      if (forgot) { setSent(await api('/auth/forgot', { method: 'POST', body: { email: f.email } })); return; }
      const r = await api('/auth/' + mode, { method: 'POST', body: mode === 'login' ? { ...f, portal } : { ...f, role: portal } });
      setSession(r.token, r.user); onAuth(r.user);
    } catch (e) { setErr(e.message); if (e.data?.retry_after) setLock(e.data.retry_after); }
    finally { setBusy(false); }
  };
  const heading = forgot ? 'Reset your password' : mode === 'login' ? `${title} sign in` : `Join as ${portal === 'mechanic' ? 'a mechanic' : 'a motorist'}`;
  const sub = forgot ? "Enter your account email and we'll send you a reset link." : portal === 'admin' ? 'Authorized FleetCare staff only.' : mode === 'login' ? 'Welcome back.' : portal === 'mechanic' ? 'An administrator will certify your account before you can accept jobs.' : 'Create your account to request help.';
  const label = lock > 0 ? `Try again in ${lock}s` : forgot ? 'Send reset link' : mode === 'login' ? 'Log in' : 'Create account';

  return (
    <div className="page auth-page">
      <div className="auth-shell">
        <aside className="auth-side card" data-role={portal}>
          <BrandRow />
          <div className="auth-side-copy">
            <span className="eyebrow">{title} portal</span>
            <h2>{portal === 'motorist' ? 'Roadside help when it matters most.' : portal === 'mechanic' ? 'Your next job is already moving.' : 'Manage the whole fleetcare network.'}</h2>
            <p className="muted">
              {portal === 'motorist' ? 'Track a mechanic live, confirm service details and complete payment without leaving the app.' : portal === 'mechanic' ? 'Accept nearby jobs, update status in real time and keep your customers informed at every step.' : 'Review requests, certify mechanics, manage pricing and keep all platform activity on track.'}
            </p>
          </div>
          <div className="auth-side-list">
            <span><b>01</b> Secure access</span>
            <span><b>02</b> Real-time updates</span>
            <span><b>03</b> Role-specific tools</span>
          </div>
        </aside>

        <section className="card auth-form-panel">
          <PageHead eyebrow={`${title} portal`} title={heading} sub={sub} />
          <div className="stack auth-form-body">
            {forgot && sent ? <>
              <p>{sent.message}</p>
              {sent.dev_link && <div className="stack"><span className="hint">Email is not configured on this server (development mode), so here is your link:</span><a className="linkbox" href={sent.dev_link}>{sent.dev_link}</a></div>}
              <button className="btn ghost" onClick={() => switchMode('login')}>Back to sign in</button></> : <>
              {mode === 'register' && <>
                <label>Full name<input autoComplete="name" onChange={set('name')} /></label>
                <label>Phone<input type="tel" autoComplete="tel" onChange={set('phone')} /></label></>}
              <label>Email<input type="email" autoComplete="email" onChange={set('email')} onKeyDown={e => forgot && e.key === 'Enter' && submit()} /></label>
              {!forgot && <label>Password<input type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} onChange={set('password')} onKeyDown={e => e.key === 'Enter' && submit()} /></label>}
              {lock > 0 ? <p className="error">Too many failed attempts. Please wait {lock} second{lock === 1 ? '' : 's'}.</p> : err && <p className="error">{err}</p>}
              <button className="btn" disabled={busy || lock > 0} onClick={submit}>{label}</button>
              {mode === 'login' && <button className="btn ghost" onClick={() => switchMode('forgot')}>Forgot password?</button>}
              {forgot && <button className="btn ghost" onClick={() => switchMode('login')}>Back to sign in</button>}
              {canRegister && !forgot && <button className="btn ghost" onClick={() => switchMode(mode === 'login' ? 'register' : 'login')}>{mode === 'login' ? 'New here? Create an account' : 'Have an account? Log in'}</button>}
              <a className="muted auth-alt-link" href="#/login">Not a {portal}? Choose another portal</a></>}
          </div>
        </section>
      </div>
    </div>);
}
