import { useEffect, useState } from 'react';
import { api, setSession } from './api';
import { PageHead, PasswordInput } from './ui';
import { BrandRow } from './Logo';

// The role is chosen only when creating an account. Admin is never selectable: it is a pre-made account.
// Logging in needs just email + password; the server knows each account's role and the app opens that portal.
const ROLES = [['motorist', 'Motorist', 'I need roadside help'], ['mechanic', 'Mechanic', 'I repair vehicles']];

export default function Auth({ initialRole, onAuth }) {
  const [mode, setMode] = useState(initialRole ? 'register' : 'login'), [role, setRole] = useState(initialRole || 'motorist'), [f, setF] = useState({}), [err, setErr] = useState('');
  const [lock, setLock] = useState(0), [sent, setSent] = useState(null), [busy, setBusy] = useState(false);
  useEffect(() => { if (lock <= 0) return; const t = setTimeout(() => setLock(l => l - 1), 1000); return () => clearTimeout(t); }, [lock]);
  useEffect(() => { if (lock === 0 && /Too many/.test(err)) setErr(''); }, [lock]);
  useEffect(() => { document.documentElement.dataset.role = mode === 'register' ? role : ''; }, [role, mode]); // accent follows the role being signed up for

  const forgot = mode === 'forgot';
  const set = k => e => setF({ ...f, [k]: e.target.value });
  const switchMode = m => { setMode(m); setErr(''); setSent(null); };
  const submit = async () => {
    setBusy(true); setErr('');
    try {
      if (forgot) { setSent(await api('/auth/forgot', { method: 'POST', body: { email: f.email } })); return; }
      const r = await api('/auth/' + mode, { method: 'POST', body: mode === 'login' ? { email: f.email, password: f.password } : { ...f, role } });
      setSession(r.token, r.user); onAuth(r.user); // App sends admins to /admin, others to their own dashboard
    } catch (e) {
      setErr(e.message);
      if (e.data?.retry_after) setLock(e.data.retry_after);
    } finally { setBusy(false); }
  };
  const heading = forgot ? 'Reset your password' : mode === 'login' ? 'Log in to FleetCare' : 'Create your account';
  const sub = forgot ? "Enter your account email and we'll send you a reset link." : mode === 'login' ? 'Enter your email and password. We open the right dashboard for your account.' : role === 'mechanic' ? 'An administrator will certify your account before you can accept jobs.' : 'Create your account to request help.';
  const label = lock > 0 ? `Try again in ${lock}s` : forgot ? 'Send reset link' : mode === 'login' ? 'Log in' : 'Create account';

  return (
    <div className="page narrow">
      <BrandRow />
      <PageHead eyebrow={forgot ? 'Account recovery' : 'UC-06'} title={heading} sub={sub} />
      <div className="card stack">
        {forgot && sent ? <>
          <p>{sent.message}</p>
          {sent.dev_link && <div className="stack"><span className="hint">Email is not configured on this server (development mode), so here is your link:</span><a className="linkbox" href={sent.dev_link}>{sent.dev_link}</a></div>}
          <button className="btn ghost" onClick={() => switchMode('login')}>Back to sign in</button></> : <>
          {mode === 'register' && <fieldset className="roles" role="radiogroup" aria-label="Role">
            <legend>Sign up as…</legend>
            {ROLES.map(([k, t, d]) => <label key={k} className={'role' + (role === k ? ' on' : '')}>
              <input type="radio" name="role" value={k} checked={role === k} onChange={() => setRole(k)} /><b>{t}</b><small>{d}</small></label>)}
          </fieldset>}
          {mode === 'register' && <>
            <label>Full name<input autoComplete="name" onChange={set('name')} /></label>
            <label>Phone<input type="tel" autoComplete="tel" onChange={set('phone')} /></label></>}
          <label>Email<input type="email" autoComplete="email" onChange={set('email')} onKeyDown={e => forgot && e.key === 'Enter' && submit()} /></label>
          {!forgot && <label>Password<PasswordInput autoComplete={mode === 'login' ? 'current-password' : 'new-password'} onChange={set('password')} onKeyDown={e => e.key === 'Enter' && submit()} /></label>}
          {lock > 0 ? <p className="error">Too many failed attempts. Please wait {lock} second{lock === 1 ? '' : 's'}.</p> : err && <p className="error">{err}</p>}
          <button className="btn" disabled={busy || lock > 0} onClick={submit}>{label}</button>
          {mode === 'login' && <button className="btn ghost" onClick={() => switchMode('forgot')}>Forgot password?</button>}
          {forgot && <button className="btn ghost" onClick={() => switchMode('login')}>Back to sign in</button>}
          {!forgot && <button className="btn ghost" onClick={() => switchMode(mode === 'login' ? 'register' : 'login')}>{mode === 'login' ? 'New here? Create an account' : 'Have an account? Log in'}</button>}
          </>}
      </div>
    </div>);
}
