import { useState } from 'react';
import { api } from './api';
import { PageHead } from './ui';
import { BrandRow } from './Logo';

export default function Reset({ token }) {
  const [pw, setPw] = useState({ password: '', confirm: '' }), [err, setErr] = useState(''), [role, setRole] = useState(null), [busy, setBusy] = useState(false);
  const submit = async () => {
    if (pw.password !== pw.confirm) return setErr('The passwords do not match');
    setBusy(true); setErr('');
    try { setRole((await api('/auth/reset', { method: 'POST', body: { token, password: pw.password } })).role); }
    catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <div className="page narrow">
      <BrandRow />
      <PageHead eyebrow="Account recovery" title={role ? 'Password updated' : 'Choose a new password'} sub={role ? 'You can now sign in with your new password.' : 'Pick a new password for your FleetCare account (at least 6 characters).'} />
      <div className="card stack">
        {role ? <a className="btn" href={'#/login/' + role}>Go to sign in</a> : !token ? <><p className="error">This reset link is incomplete.</p><a className="btn ghost" href="#/login">Back to sign in</a></> : <>
          <label>New password<input type="password" autoComplete="new-password" value={pw.password} onChange={e => setPw({ ...pw, password: e.target.value })} /></label>
          <label>Confirm new password<input type="password" autoComplete="new-password" value={pw.confirm} onChange={e => setPw({ ...pw, confirm: e.target.value })} onKeyDown={e => e.key === 'Enter' && submit()} /></label>
          {err && <p className="error">{err}</p>}
          <button className="btn" disabled={busy || !pw.password} onClick={submit}>Update password</button>
          <a className="muted" href="#/login">Back to sign in</a></>}
      </div>
    </div>);
}
