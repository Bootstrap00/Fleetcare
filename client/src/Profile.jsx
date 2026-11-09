import { useEffect, useRef, useState } from 'react';
import { api } from './api';
import { useStore } from './store';
import { Avatar, Badge, PageHead, Stars } from './ui';

// Crop to a centered square and shrink to 256px so uploads stay small (about 20 KB).
async function toAvatar(file) {
  if (!file.type.startsWith('image/')) throw new Error('Please choose an image file');
  if (file.size > 15e6) throw new Error('Choose an image under 15 MB');
  let bmp;
  try { bmp = await createImageBitmap(file); } catch { throw new Error('Could not read that image. Try a JPG or PNG.'); }
  const s = 256, c = document.createElement('canvas'); c.width = c.height = s;
  const m = Math.min(bmp.width, bmp.height);
  c.getContext('2d').drawImage(bmp, (bmp.width - m) / 2, (bmp.height - m) / 2, m, m, 0, 0, s, s);
  return c.toDataURL('image/jpeg', 0.85);
}

export default function Profile() {
  const { user, updateUser, setMsg } = useStore();
  const [me, setMe] = useState(null), [f, setF] = useState({ name: user.name, phone: '', email: '' });
  const [pw, setPw] = useState({ current: '', password: '', confirm: '' }), [busy, setBusy] = useState('');
  const pick = useRef();
  useEffect(() => { api('/me').then(m => { setMe(m); setF({ name: m.name, phone: m.phone || '', email: m.email }); }).catch(e => setMsg(e.message)); }, []);
  const run = (key, fn) => async () => { setBusy(key); try { await fn(); } catch (e) { setMsg(e.message); } finally { setBusy(''); } };

  const onFile = e => { const file = e.target.files[0]; e.target.value = ''; if (file) run('photo', async () => {
    const r = await api('/profile/avatar', { method: 'PUT', body: { image: await toAvatar(file) } });
    updateUser({ ...user, avatar_at: r.avatar_at }); setMsg('Profile photo updated.');
  })(); };
  const removePhoto = run('photo', async () => { await api('/profile/avatar', { method: 'DELETE' }); updateUser({ ...user, avatar_at: null }); setMsg('Photo removed.'); });
  const saveInfo = run('info', async () => { const r = await api('/profile', { method: 'PATCH', body: f }); updateUser({ ...user, ...r.user }, r.token); setMsg('Profile saved.'); });
  const savePw = run('pw', async () => {
    if (pw.password !== pw.confirm) throw new Error('The new passwords do not match');
    await api('/profile/password', { method: 'PUT', body: { current: pw.current, password: pw.password } });
    setPw({ current: '', password: '', confirm: '' }); setMsg('Password changed.');
  });
  const set = k => e => setF({ ...f, [k]: e.target.value }), setP = k => e => setPw({ ...pw, [k]: e.target.value });

  return (
    <div className="page narrow">
      <PageHead eyebrow={`${user.role} profile`} title="My profile" sub="Update your details, photo and password." />
      <div className="card stack">
        <div className="photo">
          <Avatar id={user.id} name={user.name} at={user.avatar_at} size={112} />
          <div className="stack">
            <b>Profile photo</b>
            <div className="actions">
              <input ref={pick} type="file" accept="image/*" hidden onChange={onFile} />
              <button className="btn sm" disabled={busy === 'photo'} onClick={() => pick.current.click()}>{busy === 'photo' ? 'Uploading…' : user.avatar_at ? 'Change photo' : 'Upload photo'}</button>
              {user.avatar_at && <button className="btn danger sm" disabled={busy === 'photo'} onClick={removePhoto}>Remove</button>}
            </div>
            <span className="hint">JPG, PNG or WebP. It is cropped to a square automatically.</span>
          </div>
        </div>
        {me && <div className="facts"><Badge s={user.role === 'mechanic' ? (me.verified ? 'completed' : 'pending') : 'accepted'} />
          {user.role === 'mechanic' && <><span className="muted">{me.verified ? 'Certified mechanic' : 'Awaiting certification'}</span>{me.rating ? <Stars value={Math.round(me.rating)} /> : null}<span className="muted">{me.jobs} jobs completed</span></>}
          <span className="muted">Member since {String(me.created_at).slice(0, 10)}</span></div>}
      </div>
      <div className="card stack">
        <h3>Personal information</h3>
        <label>Full name<input autoComplete="name" value={f.name} onChange={set('name')} /></label>
        <div className="two"><label>Phone<input type="tel" autoComplete="tel" value={f.phone} onChange={set('phone')} /></label>
          <label>Email (used to log in)<input type="email" autoComplete="email" value={f.email} onChange={set('email')} /></label></div>
        <div className="actions"><button className="btn" disabled={busy === 'info'} onClick={saveInfo}>Save changes</button></div>
      </div>
      <div className="card stack">
        <h3>Change password</h3>
        <label>Current password<input type="password" autoComplete="current-password" value={pw.current} onChange={setP('current')} /></label>
        <div className="two"><label>New password<input type="password" autoComplete="new-password" value={pw.password} onChange={setP('password')} /></label>
          <label>Confirm new password<input type="password" autoComplete="new-password" value={pw.confirm} onChange={setP('confirm')} /></label></div>
        <div className="actions"><button className="btn" disabled={busy === 'pw' || !pw.current || !pw.password} onClick={savePw}>Update password</button></div>
      </div>
    </div>);
}
