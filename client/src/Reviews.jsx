import { useEffect, useState } from 'react';
import { api } from './api';
import { Avatar, Reveal } from './ui';
import { PhotoGrid } from './Photos';

const when = d => new Date(String(d).replace(' ', 'T') + 'Z').toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
const StarText = ({ value }) => <span className="startext" role="img" aria-label={`${value} of 5 stars`}>{'★'.repeat(Math.round(value))}{'☆'.repeat(5 - Math.round(value))}</span>;

// Home-page feed: what motorists say about the mechanic who repaired their vehicle (rating, comment, photos).
export default function ReviewFeed() {
  const [list, setList] = useState(null);
  useEffect(() => { api('/reviews/recent?limit=6').then(setList).catch(() => setList([])); }, []);
  if (list && !list.length) return null;
  return (
    <section className="sec" id="reviews">
      <Reveal><span className="eyebrow">Customer reviews</span><h2>Real repairs, rated by the motorists they helped.</h2></Reveal>
      <div className="grid g3">{(list || []).map((r, i) =>
        <Reveal key={r.id} delay={i * 70} className="card review-card">
          <div className="mech-head"><Avatar id={r.mechanic_id} name={r.mechanic_name} at={r.mechanic_avatar} size={46} />
            <div><a href={'#/mechanics/' + r.mechanic_id}><b>{r.mechanic_name}</b></a>
              <small className="muted">{r.mechanic_jobs} job{r.mechanic_jobs === 1 ? '' : 's'} completed{r.mechanic_rating ? ` · ${r.mechanic_rating} avg` : ''}</small></div></div>
          <div className="rating"><StarText value={r.stars} /></div>
          {r.comment ? <p>“{r.comment}”</p> : null}
          {r.photos.length > 0 && <PhotoGrid photos={r.photos} />}
          <small className="muted">{r.motorist} · {when(r.created_at)}</small>
        </Reveal>)}</div>
    </section>);
}
