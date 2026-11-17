import { useEffect, useState } from 'react';
import { api } from './api';
import { Avatar, Empty, PageHead, Reveal, Stars, href } from './ui';
import { PhotoGrid, photoUrl } from './Photos';

const when = d => new Date(String(d).replace(' ', 'T') + 'Z').toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
const StarText = ({ value }) => <span className="startext" role="img" aria-label={`${value} of 5 stars`}>{'★'.repeat(Math.round(value))}{'☆'.repeat(5 - Math.round(value))}</span>;

// One mechanic on a card: photo, rating, short bio and a strip of previous work.
export function MechanicCard({ m }) {
  return (
    <a className="card mech" href={'#/mechanics/' + m.id}>
      <div className="mech-head"><Avatar id={m.id} name={m.name} at={m.avatar_at} size={52} />
        <div><b>{m.name}</b><div className="rating">{m.rating ? <><StarText value={m.rating} /> <span className="muted">{m.rating} ({m.reviews})</span></> : <span className="muted">No reviews yet</span>}</div></div></div>
      <p className="mech-bio">{m.bio || 'Certified FleetCare mechanic.'}</p>
      <div className="mech-pics">{[0, 1, 2].map(i => m.photos[i] ? <img key={i} src={photoUrl(m.photos[i].id)} alt="Previous work" loading="lazy" /> : <span key={i} className="ph" />)}</div>
      <small className="muted">{m.jobs} job{m.jobs === 1 ? '' : 's'} completed · {m.photo_count} photo{m.photo_count === 1 ? '' : 's'}</small>
    </a>);
}

// "Browse mechanics" section for the public landing page.
export function BrowseMechanics() {
  const [list, setList] = useState(null);
  useEffect(() => { api('/mechanics?limit=6').then(setList).catch(() => setList([])); }, []);
  if (list && !list.length) return null;
  return (
    <section className="sec" id="mechanics">
      <Reveal><span className="eyebrow">Browse mechanics</span><h2>Meet certified mechanics and see their work.</h2></Reveal>
      <div className="grid g3">{(list || []).map((m, i) => <Reveal key={m.id} delay={i * 70}><MechanicCard m={m} /></Reveal>)}</div>
      <div className="cta-row"><a className="btn ghost" href={href('/mechanics')}>See all mechanics</a></div>
    </section>);
}

export function MechanicList() {
  const [q, setQ] = useState(''), [sort, setSort] = useState('rating'), [list, setList] = useState(null);
  useEffect(() => {
    const t = setTimeout(() => api(`/mechanics?limit=60&sort=${sort}&q=${encodeURIComponent(q)}`).then(setList).catch(() => setList([])), 250);
    return () => clearTimeout(t);
  }, [q, sort]);
  return (
    <div className="page">
      <PageHead eyebrow="Browse" title="Certified mechanics" sub="Every mechanic here is certified by FleetCare. Open a profile to see photos of their previous work and reviews from motorists." />
      <div className="toolbar">
        <input placeholder="Search by name or specialty" aria-label="Search mechanics" value={q} onChange={e => setQ(e.target.value)} />
        <select aria-label="Sort" value={sort} onChange={e => setSort(e.target.value)}><option value="rating">Top rated</option><option value="jobs">Most jobs</option><option value="new">Newest</option></select>
      </div>
      {list && !list.length && <Empty title="No mechanics found">Try a different search.</Empty>}
      <div className="grid g3">{(list || []).map(m => <MechanicCard key={m.id} m={m} />)}</div>
    </div>);
}

export function MechanicProfile({ id, user }) {
  const [m, setM] = useState(null), [reviews, setReviews] = useState([]), [missing, setMissing] = useState(false);
  useEffect(() => { setM(null); setMissing(false); api('/mechanics/' + id).then(setM).catch(() => setMissing(true)); api(`/mechanics/${id}/reviews`).then(setReviews).catch(() => setReviews([])); }, [id]);
  if (missing) return <div className="page"><Empty title="Mechanic not found">This profile does not exist or is not certified yet.<a className="btn" href="#/mechanics">Browse mechanics</a></Empty></div>;
  if (!m) return <div className="page"><Empty title="Loading…" /></div>;
  const gallery = m.photos.map(p => ({ id: p.id, caption: p.caption || (p.source === 'review' ? 'From a verified customer review' : 'Portfolio photo') }));
  return (
    <div className="page">
      <a className="muted" href="#/mechanics">← All mechanics</a>
      <div className="card mech-hero">
        <Avatar id={m.id} name={m.name} at={m.avatar_at} size={96} />
        <div className="stack"><h1>{m.name}</h1>
          <div className="rating">{m.rating ? <><Stars value={Math.round(m.rating)} /> <b>{m.rating}</b> <span className="muted">({m.reviews} review{m.reviews === 1 ? '' : 's'})</span></> : <span className="muted">No reviews yet</span>}</div>
          <p>{m.bio || 'Certified FleetCare mechanic.'}</p>
          <div className="chips"><span className="chip">{m.jobs} jobs completed</span><span className="chip">{m.photo_count} work photos</span><span className="chip">Member since {when(m.created_at)}</span></div></div>
        {user?.role === 'motorist' ? <a className="btn" href={href('/request')}>Request roadside help</a> : !user ? <a className="btn" href="#/login">Log in to request help</a> : null}
      </div>
      <h2 className="sub">Work gallery</h2>
      {gallery.length ? <PhotoGrid photos={gallery} size={132} /> : <p className="muted">No photos yet.</p>}
      <h2 className="sub">Reviews</h2>
      {!reviews.length && <p className="muted">No reviews yet.</p>}
      <div className="stack">{reviews.map(r => (
        <Reveal key={r.id} className="card review-card">
          <div className="row-top"><Avatar id={r.reviewer_id} name={r.reviewer} at={r.reviewer_avatar} size={32} /><b>{r.reviewer}</b><Stars value={r.stars} /><small className="muted">{when(r.created_at)}</small></div>
          {r.comment ? <p>“{r.comment}”</p> : null}
          <PhotoGrid photos={r.photos} size={72} />
        </Reveal>))}</div>
    </div>);
}
