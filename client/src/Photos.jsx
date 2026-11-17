import { useEffect, useState } from 'react';
import { Stars } from './ui';

export const photoUrl = id => `/api/photos/${id}`;

// Full-screen viewer: click a thumbnail to open, Esc or click outside to close, arrow keys to browse.
export function Lightbox({ photos, index, onClose }) {
  const [i, setI] = useState(index), n = photos.length, p = photos[i];
  useEffect(() => {
    const key = e => { if (e.key === 'Escape') onClose(); if (e.key === 'ArrowRight') setI(x => (x + 1) % n); if (e.key === 'ArrowLeft') setI(x => (x - 1 + n) % n); };
    addEventListener('keydown', key); return () => removeEventListener('keydown', key);
  }, [n]);
  return (
    <div className="lightbox" role="dialog" aria-label="Photo viewer" onClick={onClose}>
      <figure onClick={e => e.stopPropagation()}>
        <img src={photoUrl(p.id)} alt={p.caption || 'Work photo'} />
        <figcaption>{p.caption || ''}{n > 1 ? <span className="muted"> {i + 1} / {n}</span> : null}</figcaption>
        {n > 1 && <div className="actions"><button className="btn ghost sm" onClick={() => setI((i - 1 + n) % n)}>Previous</button><button className="btn ghost sm" onClick={() => setI((i + 1) % n)}>Next</button></div>}
      </figure>
      <button className="btn ghost sm close" onClick={onClose}>Close</button>
    </div>);
}

// Thumbnails. `photos` = array of ids or { id, caption }. Pass onDelete(id) to show a remove button.
export function PhotoGrid({ photos = [], size = 84, onDelete }) {
  const list = photos.map(p => (typeof p === 'object' ? p : { id: p })), [open, setOpen] = useState(null);
  if (!list.length) return null;
  return (<>
    <div className="thumbs">{list.map((p, i) => (
      <span className="thumb" key={p.id} style={{ width: size, height: size }}>
        <button type="button" aria-label="View photo" onClick={() => setOpen(i)}><img src={photoUrl(p.id)} alt={p.caption || 'Work photo'} loading="lazy" /></button>
        {onDelete && <button type="button" className="x" aria-label="Delete photo" onClick={() => onDelete(p.id)}>×</button>}
      </span>))}</div>
    {open != null && <Lightbox photos={list} index={open} onClose={() => setOpen(null)} />}
  </>);
}

// A finished review: stars, comment and photos (used for mechanics and admins; the motorist has RateBox).
export function ReviewView({ r }) {
  if (!r.my_rating) return null;
  const ids = r.review_photo_ids ? String(r.review_photo_ids).split(',').map(Number) : [];
  return (<div className="review"><Stars value={r.my_rating} />{r.my_comment ? <p>“{r.my_comment}”</p> : null}<PhotoGrid photos={ids} /></div>);
}
