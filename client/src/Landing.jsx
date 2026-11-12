import { lazy, Suspense, useEffect, useState } from 'react';
import { api } from './api';
import { Reveal, href, peso } from './ui';
import { LogoMark, Wordmark } from './Logo';
const Hero3D = lazy(() => import('./Hero3D'));

const MQ = ['24/7 dispatch', 'Certified mechanics', 'Live tracking', 'Secure payments', 'Real-time chat', 'Works offline'];
const STEPS = [['01', 'Pin your location', 'Drop a pin on the map where you broke down and describe the problem.'], ['02', 'Broadcast a radius', 'Certified mechanics inside your distress radius are alerted instantly.'], ['03', 'Track the arrival', 'Watch your mechanic approach live and chat while they drive over.'], ['04', 'Pay and rate', 'Settle the support and service fees securely, then rate your mechanic.']];
const ACTORS = [
  ['Motorist', 'Everything a stranded driver needs', [['01', 'Pin breakdown location'], ['02', 'Submit assistance request'], ['03', 'Track mechanic arrival'], ['04', 'Pay support and main fees'], ['05', 'Rate mechanic'], ['06', 'Register / log in']]],
  ['Mechanic', 'Jobs that come to you', [['07', 'Receive and accept jobs'], ['08', 'Update job status'], ['09', 'Complete job'], ['06', 'Register / log in']]],
  ['Administrator', 'Run the whole platform', [['10', 'Manage users and mechanics'], ['11', 'Manage services and fees'], ['12', 'Manage website content'], ['13', 'Generate reports'], ['14', 'Send email notifications']]],
];
const FEATURES = [
  ['Live dispatch', 'Alert the nearest certified mechanics in seconds to reduce downtime.'],
  ['Trusted mechanics', 'Filter by verification, rating and real-time availability.'],
  ['Secure payment', 'Support and service fees are paid in a smooth driver-safe flow.'],
  ['Always on', 'Offline-ready workflows and push alerts keep updates moving.'],
];

export default function Landing({ user }) {
  const [c, setC] = useState({}), [stats, setStats] = useState(null), [fees, setFees] = useState(null), [news, setNews] = useState([]);
  useEffect(() => { api('/content').then(setC).catch(() => {}); api('/stats').then(setStats).catch(() => {}); api('/config').then(setFees).catch(() => {}); api('/announcements').then(setNews).catch(() => {}); }, []);
  const words = (c.hero_title || 'Stranded? Help is already moving.').split(' '), last = words.pop();
  const [to, label] = user ? ['/dashboard', 'Open my portal'] : ['/login/motorist', c.cta_label || 'Request roadside help'];
  return (<>
    <section className="hero">
      <Suspense fallback={null}><Hero3D /></Suspense>
      <div className="hero-copy">
        <span className="eyebrow">Live roadside dispatch</span>
        <h1>{words.join(' ')} <span className="grad">{last}</span></h1>
        <p className="lead">{c.hero_sub || 'FleetCare connects stranded motorists with certified mobile mechanics in minutes.'}</p>
        <div className="cta-row">
          <a className="btn" href={href(to)}>{label}</a>
          <button className="btn ghost" onClick={() => document.getElementById('how')?.scrollIntoView({ behavior: 'smooth' })}>How it works</button>
        </div>
        {!user && <p className="muted portal-links">Mechanic? <a href="#/login/mechanic">Sign in here</a> · Staff? <a href="#/login/admin">Admin login</a></p>}
        <div className="hero-metrics" aria-label="Platform overview">
          <div className="metric-pill"><strong>24/7</strong><span>Live dispatch</span></div>
          <div className="metric-pill"><strong>4.8/5</strong><span>Member rating</span></div>
          <div className="metric-pill"><strong>3 min</strong><span>Avg. response</span></div>
        </div>
        {news[0] && <div className="notice"><b>{news[0].title}</b> {news[0].body}</div>}
      </div>
    </section>

    <div className="marquee" aria-hidden="true"><div>{[...MQ, ...MQ].map((t, i) => <span key={i}>{t}</span>)}</div></div>

    <section className="sec">
      <div className="grid g3 stats">
        {[[stats?.mechanics, 'Certified mechanics'], [stats?.jobs, 'Jobs completed'], [stats?.rating ? stats.rating + ' / 5' : null, 'Average rating']].map(([v, l], i) =>
          <Reveal key={l} delay={i * 90} className="card stat highlight"><b>{v ?? '—'}</b><span>{l}</span></Reveal>)}
      </div>
    </section>

    <section className="sec">
      <Reveal><span className="eyebrow">Why drivers choose FleetCare</span><h2>Fast, trusted roadside help built for real-life breakdowns.</h2></Reveal>
      <div className="grid g4 feature-grid">
        {FEATURES.map(([title, desc], i) => (
          <Reveal key={title} delay={i * 80} className="card feature-card">
            <span className="feature-icon">{i + 1}</span>
            <h3>{title}</h3>
            <p>{desc}</p>
          </Reveal>
        ))}
      </div>
    </section>

    <section className="sec" id="how">
      <Reveal><span className="eyebrow">How it works</span><h2>From breakdown to back on the road in four moves.</h2></Reveal>
      <div className="grid g4">{STEPS.map(([n, t, d], i) => <Reveal key={n} delay={i * 90} className="card step"><b>{n}</b><h3>{t}</h3><p>{d}</p></Reveal>)}</div>
    </section>

    <section className="sec">
      <Reveal><span className="eyebrow">One platform, three roles</span><h2>Built for everyone on the roadside.</h2></Reveal>
      <div className="grid g3">{ACTORS.map(([t, d, items], i) =>
        <Reveal key={t} delay={i * 90} className="card"><h3>{t}</h3><p className="muted">{d}</p>
          <div className="chips">{items.map(([n, l]) => <span className="chip" key={n + l}><i>UC-{n}</i>{l}</span>)}</div></Reveal>)}</div>
    </section>

    <section className="sec">
      <Reveal><span className="eyebrow">Transparent pricing</span><h2>A dispatch fee plus a service fee by severity.</h2></Reveal>
      <div className="grid g4">{fees && [['Dispatch support', fees.support, 'Per roadside dispatch call'], ['Minor', fees.main.minor, 'Flat tire, jump start'], ['Moderate', fees.main.moderate, 'Battery, belts, overheating'], ['Major', fees.main.major, 'Engine, transmission, electrical']]
        .map(([t, a, d], i) => <Reveal key={t} delay={i * 80} className="card price"><span className="muted">{t}</span><b>{peso(a)}</b><small>{d}</small></Reveal>)}</div>
    </section>

    <section className="sec">
      <Reveal className="card cta-band"><div className="brand-row"><LogoMark size={76} /><div><Wordmark /><h2>Don't wait on the shoulder.</h2></div></div><a className="btn" href={href(to)}>{label}</a></Reveal>
    </section>
  </>);
}
