import { useEffect, useRef, useState } from 'react';
import { api } from './api';
import { useStore } from './store';
import { resizeImage } from './images';
import { PhotoGrid } from './Photos';
import { href } from './ui';

// Mechanic's own portfolio manager (max 24 photos). Shown on the Profile page.
export default function Portfolio({ me }) {
  const { setMsg } = useStore();
  const [items, setItems] = useState([]), [busy, setBusy] = useState(false), pick = useRef();
  const refresh = () => api('/portfolio').then(setItems).catch(e => setMsg(e.message));
  useEffect(() => { refresh(); }, []);
  const add = async e => {
    const files = [...e.target.files].slice(0, 24 - items.length); e.target.value = ''; setBusy(true);
    try { for (const f of files) await api('/portfolio', { method: 'POST', body: { image: await resizeImage(f) } }); setMsg('Portfolio updated.'); }
    catch (err) { setMsg(err.message); } finally { setBusy(false); refresh(); }
  };
  const del = async id => { try { await api('/photos/' + id, { method: 'DELETE' }); } catch (err) { setMsg(err.message); } refresh(); };
  return (
    <div className="card stack">
      <h3>Portfolio</h3>
      <p className="muted">Show motorists your best work. Photos appear on your public profile and on the home page once you are certified.</p>
      <PhotoGrid photos={items} onDelete={del} />
      <div className="actions">
        <input ref={pick} type="file" accept="image/*" multiple hidden onChange={add} />
        <button className="btn sm" disabled={busy || items.length >= 24} onClick={() => pick.current.click()}>{busy ? 'Uploading…' : 'Add photos'} ({items.length}/24)</button>
        {me?.verified ? <a className="btn ghost sm" href={href(`/mechanics/${me.id}`)}>View my public profile</a> : <span className="hint">Your public profile appears after an administrator certifies you.</span>}
      </div>
    </div>);
}
