import './env.js';
import express from 'express';
import cors from 'cors';
import http from 'http';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import Stripe from 'stripe';
import { WebSocketServer } from 'ws';
import db, { getFees, CONTENT } from './db.js';
import { notifyEmail, notifyPush } from './notify.js';

const SECRET = process.env.JWT_SECRET || 'dev-secret';
const CLIENT = process.env.CLIENT_URL || 'http://localhost:5173';
const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null;
const app = express();
app.use(cors(), express.json({ limit: '600kb' }));
const server = http.createServer(app);

if (!db.prepare("SELECT 1 FROM users WHERE role='admin'").get())
  db.prepare('INSERT INTO users(name,email,password,role) VALUES(?,?,?,?)').run('Admin', 'admin@fleetcare.local', bcrypt.hashSync('admin123', 10), 'admin');

// ---- helpers
const sign = u => jwt.sign({ id: u.id, role: u.role, name: u.name }, SECRET, { expiresIn: '7d' });
const auth = roles => (req, res, next) => {
  try {
    req.user = jwt.verify((req.headers.authorization || '').replace('Bearer ', ''), SECRET);
    if (!db.prepare('SELECT 1 FROM users WHERE id=? AND deleted_at IS NULL').get(req.user.id)) throw new Error('inactive');
    if (roles && !roles.includes(req.user.role)) return res.status(403).json({ error: 'Not allowed for your role' });
    next();
  } catch { res.status(401).json({ error: 'Please log in' }); }
};
const km = (a, b, c, d) => { const r = x => x * Math.PI / 180, h = Math.sin(r(c - a) / 2) ** 2 + Math.cos(r(a)) * Math.cos(r(c)) * Math.sin(r(d - b) / 2) ** 2; return 12742 * Math.asin(Math.sqrt(h)); };
const getReq = id => db.prepare('SELECT * FROM requests WHERE id=?').get(id);
const getUser = id => db.prepare('SELECT * FROM users WHERE id=?').get(id);
const socks = new Map();
const emit = (uid, msg) => socks.get(uid)?.forEach(w => w.send(JSON.stringify(msg)));
const Q = `SELECT r.*, m.name mechanic_name, m.lat mechanic_lat, m.lng mechanic_lng, m.avatar_at mechanic_avatar, u.name motorist_name, u.avatar_at motorist_avatar,
  (SELECT ROUND(AVG(stars),1) FROM ratings WHERE mechanic_id=r.mechanic_id) mechanic_rating,
  (SELECT stars FROM ratings WHERE request_id=r.id) my_rating
  FROM requests r LEFT JOIN users m ON m.id=r.mechanic_id LEFT JOIN users u ON u.id=r.motorist_id`;

// ---- login protection: N failed attempts -> cooldown (in memory)
const LOGIN_MAX = Number(process.env.LOGIN_MAX_ATTEMPTS) || 5, LOGIN_LOCK = Number(process.env.LOGIN_LOCK_SECONDS) || 30;
const fails = new Map(); // key -> { n, until, last }
const lockLeft = key => { const f = fails.get(key); if (!f?.until) return 0; const left = f.until - Date.now(); if (left > 0) return Math.ceil(left / 1000); fails.delete(key); return 0; };
const recordFail = (key, max = LOGIN_MAX, lockMs = LOGIN_LOCK * 1000) => {
  const f = fails.get(key) || { n: 0, until: 0, last: 0 };
  if (Date.now() - f.last > 15 * 60 * 1000) f.n = 0; // old failures are forgotten
  f.n++; f.last = Date.now(); if (f.n >= max) f.until = Date.now() + lockMs;
  fails.set(key, f); return Math.max(0, max - f.n);
};
setInterval(() => { for (const k of fails.keys()) lockLeft(k); }, 60_000).unref();
const sha = t => crypto.createHash('sha256').update(t).digest('hex');

// ---- unanswered requests expire
const TIMEOUT_MIN = Number(process.env.REQUEST_TIMEOUT_MIN) || 10;
function expireStale() {
  const rows = db.prepare("UPDATE requests SET status='expired' WHERE status='pending' AND deleted_at IS NULL AND created_at <= datetime('now', ?) RETURNING id, motorist_id").all(`-${Math.round(TIMEOUT_MIN * 60)} seconds`);
  if (!rows.length) return;
  const mechs = db.prepare("SELECT id FROM users WHERE role='mechanic'").all();
  for (const r of rows) {
    const upd = getReq(r.id);
    emit(r.motorist_id, { type: 'request_update', request: upd });
    mechs.forEach(m => emit(m.id, { type: 'request_update', request: upd }));
    notifyPush(r.motorist_id, { title: 'No mechanic available', body: 'Your request expired. Try again with a wider radius.' });
    notifyEmail(getUser(r.motorist_id).email, 'Your FleetCare request expired', `No mechanic accepted request #${r.id} within ${TIMEOUT_MIN} minutes. You can resend it from My requests, ideally with a wider radius.`);
  }
}

// ---- auth
app.get('/api/config', (_, res) => res.json({ ...getFees(), timeout_min: TIMEOUT_MIN }));
app.get('/api/announcements', (_, res) => res.json(db.prepare('SELECT id,title,body FROM announcements WHERE published=1 ORDER BY id DESC LIMIT 3').all()));
app.post('/api/auth/register', (req, res) => {
  const { name, email, password, phone, role } = req.body;
  if (!name || !email || !password || !['motorist', 'mechanic'].includes(role)) return res.status(400).json({ error: 'Fill in name, email, password and role' });
  try {
    const id = db.prepare('INSERT INTO users(name,email,password,phone,role) VALUES(?,?,?,?,?)').run(name, email.toLowerCase(), bcrypt.hashSync(password, 10), phone || null, role).lastInsertRowid;
    const user = { id: Number(id), name, role };
    if (role === 'mechanic') notifyEmail('admin@fleetcare.local', 'Mechanic awaiting certification', `${name} (${email}) registered as a mechanic.`);
    res.json({ token: sign(user), user });
  } catch { res.status(409).json({ error: 'Email is already registered' }); }
});
app.post('/api/auth/login', (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase(), key = `${req.ip}|${email}`;
  const wait = lockLeft(key);
  if (wait) return res.status(429).json({ error: `Too many failed attempts. Try again in ${wait} seconds.`, retry_after: wait });
  const u = db.prepare('SELECT * FROM users WHERE email=? AND deleted_at IS NULL').get(email);
  if (!u || !bcrypt.compareSync(String(req.body.password || ''), u.password)) {
    const left = recordFail(key), locked = lockLeft(key);
    if (locked) return res.status(429).json({ error: `Too many failed attempts. Try again in ${locked} seconds.`, retry_after: locked });
    return res.status(401).json({ error: `Wrong email or password. ${left} attempt${left === 1 ? '' : 's'} left.`, attempts_left: left });
  }
  fails.delete(key);
  if (req.body.portal && req.body.portal !== u.role) return res.status(403).json({ error: `This is a ${u.role} account. Please sign in through the ${u.role} portal.` });
  res.json({ token: sign(u), user: { id: u.id, name: u.name, role: u.role, avatar_at: u.avatar_at } });
});
// ---- forgot / reset password (emailed one-time link, valid 30 minutes)
app.post('/api/auth/forgot', (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase(), key = `forgot|${req.ip}|${email}`;
  const wait = lockLeft(key);
  if (wait) return res.status(429).json({ error: `Too many reset requests. Try again in ${wait} seconds.`, retry_after: wait });
  recordFail(key, 3, 60_000); // at most 3 reset emails, then a 60 second pause
  const out = { ok: true, message: 'If an account exists for that email, we sent a password reset link. It expires in 30 minutes.' };
  const u = db.prepare('SELECT * FROM users WHERE email=? AND deleted_at IS NULL').get(email);
  if (u) {
    const token = crypto.randomBytes(32).toString('hex'), link = `${CLIENT}/#/reset/${token}`;
    db.prepare('DELETE FROM password_resets WHERE user_id=?').run(u.id); // a new link cancels older ones
    db.prepare('INSERT INTO password_resets(token_hash,user_id,expires_at) VALUES(?,?,?)').run(sha(token), u.id, new Date(Date.now() + 30 * 60_000).toISOString());
    notifyEmail(u.email, 'Reset your FleetCare password', 'We received a request to reset your password. This link works once and expires in 30 minutes. If you did not ask for this, you can ignore this email.', { label: 'Reset password', url: link });
    if (!process.env.SMTP_HOST) out.dev_link = link; // DEV ONLY: no email server configured, so show the link here
  }
  res.json(out);
});
app.post('/api/auth/reset', (req, res) => {
  const pw = String(req.body.password || '');
  if (pw.length < 6) return res.status(400).json({ error: 'New password must be at least 6 characters' });
  const row = db.prepare('SELECT * FROM password_resets WHERE token_hash=?').get(sha(String(req.body.token || '')));
  const u = row && getUser(row.user_id);
  if (!row || !u || u.deleted_at || new Date(row.expires_at) < new Date()) {
    if (row) db.prepare('DELETE FROM password_resets WHERE token_hash=?').run(row.token_hash);
    return res.status(400).json({ error: 'This reset link is invalid or has expired. Please request a new one.' });
  }
  db.prepare('UPDATE users SET password=? WHERE id=?').run(bcrypt.hashSync(pw, 10), u.id);
  db.prepare('DELETE FROM password_resets WHERE user_id=?').run(u.id);
  for (const k of [...fails.keys()]) if (!k.startsWith('forgot|') && k.endsWith('|' + u.email)) fails.delete(k); // lift the login lock (keep the reset-email limit)
  notifyEmail(u.email, 'Your FleetCare password was changed', 'Your password was just changed. If this was not you, reset it again right away.');
  res.json({ ok: true, role: u.role });
});
app.get('/api/me', auth(), (req, res) => {
  const u = getUser(req.user.id);
  res.json({ id: u.id, name: u.name, role: u.role, email: u.email, phone: u.phone, avatar_at: u.avatar_at, created_at: u.created_at, verified: !!u.verified, ...db.prepare(`SELECT
    (SELECT ROUND(AVG(stars),1) FROM ratings WHERE mechanic_id=?) rating,
    (SELECT COUNT(*) FROM requests WHERE mechanic_id=? AND status='completed') jobs,
    (SELECT COALESCE(SUM(main_fee),0) FROM requests WHERE mechanic_id=? AND paid=1) earned`).get(u.id, u.id, u.id) });
});

// ---- profile (all roles): details, password, photo
app.patch('/api/profile', auth(), (req, res) => {
  const u = getUser(req.user.id);
  const name = String(req.body.name ?? u.name).trim().slice(0, 80), phone = String(req.body.phone ?? u.phone ?? '').trim().slice(0, 30);
  const email = String(req.body.email ?? u.email).trim().toLowerCase();
  if (!name) return res.status(400).json({ error: 'Name cannot be empty' });
  if (!/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ error: 'Enter a valid email address' });
  try { db.prepare('UPDATE users SET name=?,phone=?,email=? WHERE id=?').run(name, phone || null, email, u.id); }
  catch { return res.status(409).json({ error: 'That email is already in use' }); }
  const user = { id: u.id, name, role: u.role };
  res.json({ token: sign(user), user });
});
app.put('/api/profile/password', auth(), (req, res) => {
  const u = getUser(req.user.id), next = String(req.body.password || '');
  if (!bcrypt.compareSync(String(req.body.current || ''), u.password)) return res.status(400).json({ error: 'Your current password is incorrect' });
  if (next.length < 6) return res.status(400).json({ error: 'New password must be at least 6 characters' });
  db.prepare('UPDATE users SET password=? WHERE id=?').run(bcrypt.hashSync(next, 10), u.id);
  res.json({ ok: true });
});
app.put('/api/profile/avatar', auth(), (req, res) => {
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(req.body.image || '');
  if (!m) return res.status(400).json({ error: 'Upload a JPG, PNG or WebP image' });
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > 300 * 1024) return res.status(400).json({ error: 'Image is too large (max 300 KB)' });
  const at = Date.now().toString(36);
  db.prepare('UPDATE users SET avatar=?,avatar_type=?,avatar_at=? WHERE id=?').run(buf, m[1], at, req.user.id);
  res.json({ avatar_at: at });
});
app.delete('/api/profile/avatar', auth(), (req, res) => {
  db.prepare('UPDATE users SET avatar=NULL,avatar_type=NULL,avatar_at=NULL WHERE id=?').run(req.user.id);
  res.json({ ok: true });
});
app.get('/api/users/:id/avatar', (req, res) => { // public: <img> tags cannot send auth headers; URL carries a version for caching
  const u = db.prepare('SELECT avatar,avatar_type FROM users WHERE id=? AND deleted_at IS NULL').get(req.params.id);
  if (!u?.avatar) return res.status(404).end();
  res.type(u.avatar_type).set('Cache-Control', 'public, max-age=31536000, immutable').send(Buffer.from(u.avatar));
});

// ---- admin: certify mechanics
app.get('/api/users', auth(['admin']), (_, res) => res.json(db.prepare(`SELECT u.id,u.name,u.email,u.phone,u.role,u.verified,u.deleted_at,u.avatar_at,
  (SELECT ROUND(AVG(stars),1) FROM ratings WHERE mechanic_id=u.id) rating,
  (SELECT COUNT(*) FROM requests WHERE mechanic_id=u.id AND status='completed') jobs FROM users u ORDER BY u.id DESC`).all()));
app.patch('/api/users/:id/active', auth(['admin']), (req, res) => { // UC-10: deactivate / reactivate (soft delete)
  db.prepare(`UPDATE users SET deleted_at=${req.body.active ? 'NULL' : "datetime('now')"} WHERE id=? AND role!='admin'`).run(req.params.id);
  res.json({ ok: true });
});
app.patch('/api/users/:id/verify', auth(['admin']), (req, res) => {
  db.prepare("UPDATE users SET verified=? WHERE id=? AND role='mechanic'").run(req.body.verified ? 1 : 0, req.params.id);
  res.json({ ok: true });
});
app.patch('/api/me/location', auth(['mechanic']), (req, res) => {
  if (typeof req.body.lat !== 'number' || typeof req.body.lng !== 'number') return res.status(400).json({ error: 'lat and lng required' });
  db.prepare('UPDATE users SET lat=?,lng=? WHERE id=?').run(req.body.lat, req.body.lng, req.user.id);
  res.json({ ok: true });
});

// ---- UC-11 services & fees, UC-12 website content, public stats
app.put('/api/fees', auth(['admin']), (req, res) => {
  const keys = ['support', 'minor', 'moderate', 'major'];
  for (const k of keys) { const v = Number(req.body[k]); if (!Number.isInteger(v) || v < 0) return res.status(400).json({ error: `Enter a whole number for ${k}` }); }
  const up = db.prepare('UPDATE fee_schedule SET amount=? WHERE code=?');
  keys.forEach(k => up.run(Number(req.body[k]), k));
  res.json(getFees());
});
app.get('/api/content', (_, res) => res.json({ ...CONTENT, ...Object.fromEntries(db.prepare('SELECT key,value FROM site_content').all().map(r => [r.key, r.value])) }));
app.put('/api/content', auth(['admin']), (req, res) => {
  const up = db.prepare('INSERT OR REPLACE INTO site_content(key,value) VALUES(?,?)');
  Object.keys(CONTENT).forEach(k => typeof req.body[k] === 'string' && up.run(k, req.body[k].slice(0, 400)));
  res.json({ ok: true });
});
app.get('/api/stats', (_, res) => res.json(db.prepare(`SELECT
  (SELECT COUNT(*) FROM users WHERE role='mechanic' AND verified=1 AND deleted_at IS NULL) mechanics,
  (SELECT COUNT(*) FROM requests WHERE status='completed') jobs,
  (SELECT ROUND(AVG(stars),1) FROM ratings) rating`).get()));
const nv = v => (v === undefined ? null : v);
app.get('/api/admin/announcements', auth(['admin']), (_, res) => res.json(db.prepare('SELECT * FROM announcements ORDER BY id DESC').all()));
app.post('/api/admin/announcements', auth(['admin']), (req, res) => {
  if (!req.body.title) return res.status(400).json({ error: 'Title is required' });
  db.prepare('INSERT INTO announcements(title,body) VALUES(?,?)').run(String(req.body.title).slice(0, 120), String(req.body.body || '').slice(0, 400));
  res.json({ ok: true });
});
app.patch('/api/admin/announcements/:id', auth(['admin']), (req, res) => {
  db.prepare('UPDATE announcements SET title=COALESCE(?,title), body=COALESCE(?,body), published=COALESCE(?,published) WHERE id=?')
    .run(nv(req.body.title), nv(req.body.body), req.body.published === undefined ? null : (req.body.published ? 1 : 0), req.params.id);
  res.json({ ok: true });
});
app.delete('/api/admin/announcements/:id', auth(['admin']), (req, res) => { db.prepare('DELETE FROM announcements WHERE id=?').run(req.params.id); res.json({ ok: true }); });

// ---- UC-13 reports
app.get('/api/reports', auth(['admin']), (_, res) => {
  const one = sql => db.prepare(sql).get(), all = sql => db.prepare(sql).all(), live = 'deleted_at IS NULL';
  res.json({
    totals: one(`SELECT COUNT(*) requests, COALESCE(SUM(status='completed'),0) completed, COALESCE(SUM(status='cancelled'),0) cancelled, COALESCE(SUM(status='expired'),0) expired,
      COALESCE(SUM(status IN ('pending','accepted','enroute','arrived')),0) active,
      COALESCE(SUM(CASE WHEN paid=1 THEN support_fee+main_fee END),0) revenue,
      COALESCE(SUM(CASE WHEN paid=0 AND status='completed' THEN support_fee+main_fee END),0) outstanding FROM requests WHERE ${live}`),
    users: one(`SELECT COALESCE(SUM(role='motorist'),0) motorists, COALESCE(SUM(role='mechanic'),0) mechanics, COALESCE(SUM(role='mechanic' AND verified=1),0) certified FROM users WHERE ${live}`),
    rating: one('SELECT ROUND(AVG(stars),2) avg, COUNT(*) count FROM ratings'),
    bySeverity: all(`SELECT severity, COUNT(*) count, COALESCE(SUM(CASE WHEN paid=1 THEN support_fee+main_fee END),0) revenue FROM requests WHERE ${live} GROUP BY severity`),
    daily: all(`SELECT date(created_at) day, COUNT(*) count FROM requests WHERE ${live} AND created_at >= date('now','-6 days') GROUP BY day ORDER BY day`),
    mechanics: all(`SELECT u.name, COUNT(r.id) jobs, ROUND(AVG(rt.stars),1) rating, COALESCE(SUM(CASE WHEN r.paid=1 THEN r.main_fee END),0) earned
      FROM users u LEFT JOIN requests r ON r.mechanic_id=u.id AND r.status='completed' LEFT JOIN ratings rt ON rt.request_id=r.id
      WHERE u.role='mechanic' AND u.deleted_at IS NULL GROUP BY u.id ORDER BY jobs DESC LIMIT 10`)
  });
});
app.get('/api/reports.csv', auth(['admin']), (_, res) => {
  const rows = db.prepare(`${Q} WHERE r.deleted_at IS NULL ORDER BY r.id`).all();
  const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const head = ['id', 'created_at', 'motorist', 'mechanic', 'severity', 'status', 'issue', 'support_fee', 'main_fee', 'total', 'paid'];
  const csv = [head.join(','), ...rows.map(r => [r.id, r.created_at, r.motorist_name, r.mechanic_name, r.severity, r.status, r.issue, r.support_fee, r.main_fee, r.support_fee + r.main_fee, r.paid ? 'yes' : 'no'].map(esc).join(','))].join('\n');
  res.type('text/csv').set('Content-Disposition', 'attachment; filename=fleetcare-report.csv').send(csv);
});

// ---- requests (CRUD + soft delete)
app.post('/api/requests', auth(['motorist']), (req, res) => {
  const { lat, lng, issue, severity, radius_km = 10 } = req.body, FEES = getFees();
  if (typeof lat !== 'number' || typeof lng !== 'number' || !FEES.main[severity]) return res.status(400).json({ error: 'Pin your location and pick a severity' });
  const id = db.prepare('INSERT INTO requests(motorist_id,lat,lng,issue,severity,radius_km,support_fee,main_fee) VALUES(?,?,?,?,?,?,?,?)')
    .run(req.user.id, lat, lng, issue || '', severity, radius_km, FEES.support, FEES.main[severity]).lastInsertRowid;
  const r = getReq(id);
  // broadcast distress to certified mechanics inside the radius
  // every mechanic can see the request (live), but only certified mechanics inside the radius get push + email alerts
  const everyone = db.prepare("SELECT * FROM users WHERE role='mechanic' AND deleted_at IS NULL").all();
  everyone.forEach(m => emit(m.id, { type: 'new_request', request: r }));
  const mechs = everyone.filter(m => m.verified && m.lat != null && km(lat, lng, m.lat, m.lng) <= radius_km);
  mechs.forEach(m => {
    notifyPush(m.id, { title: 'Breakdown nearby', body: `${severity} issue within ${radius_km} km` });
    notifyEmail(m.email, 'New roadside request nearby', `${issue || 'No description'}\nSeverity: ${severity}`);
  });
  notifyEmail(getUser(req.user.id).email, 'FleetCare request received', `We alerted ${mechs.length} mechanic(s) within ${radius_km} km, and every mechanic can see your request.`);
  res.json({ ...r, notified: mechs.length, visible_to: everyone.length });
});
app.patch('/api/requests/:id', auth(['motorist']), (req, res) => { // UPDATE: edit a request while it is still pending
  const r = getReq(req.params.id), FEES = getFees();
  if (!r || r.motorist_id !== req.user.id || r.deleted_at) return res.status(404).json({ error: 'Request not found' });
  if (r.status !== 'pending') return res.status(409).json({ error: 'Only pending requests can be edited' });
  const { issue = r.issue, severity = r.severity, radius_km = r.radius_km, lat = r.lat, lng = r.lng } = req.body;
  if (typeof lat !== 'number' || typeof lng !== 'number' || !FEES.main[severity]) return res.status(400).json({ error: 'Invalid details' });
  db.prepare('UPDATE requests SET issue=?,severity=?,radius_km=?,lat=?,lng=?,support_fee=?,main_fee=? WHERE id=?').run(issue || '', severity, radius_km, lat, lng, FEES.support, FEES.main[severity], r.id);
  res.json(getReq(r.id));
});
app.get('/api/requests', auth(), (req, res) => {
  expireStale();
  const u = req.user, arch = req.query.archived === '1';
  let rows = db.prepare(`${Q} WHERE r.deleted_at IS ${arch ? 'NOT NULL' : 'NULL'} ORDER BY r.id DESC`).all();
  if (u.role === 'motorist') rows = rows.filter(r => r.motorist_id === u.id);
  if (u.role === 'mechanic') {
    const me = getUser(u.id);
    // any mechanic may view every open request; distance and "in range" help them choose
    rows = rows.filter(r => r.mechanic_id === u.id || (!arch && r.status === 'pending'))
      .map(r => { if (me.lat == null || r.mechanic_id) return r; const d = km(me.lat, me.lng, r.lat, r.lng); return { ...r, distance_km: Math.round(d * 10) / 10, in_range: d <= r.radius_km }; });
  }
  res.json(rows);
});
app.patch('/api/requests/:id/status', auth(['mechanic', 'motorist']), (req, res) => {
  expireStale();
  const r = getReq(req.params.id), s = req.body.status, u = req.user;
  if (!r || r.deleted_at) return res.status(404).json({ error: 'Request not found' });
  const flow = { pending: ['accepted'], accepted: ['enroute'], enroute: ['arrived'], arrived: ['completed'] };
  if (u.role === 'motorist') {
    if (r.motorist_id !== u.id || s !== 'cancelled' || ['completed', 'cancelled', 'expired'].includes(r.status)) return res.status(403).json({ error: 'Not allowed' });
  } else if (s === 'accepted') {
    if (r.status !== 'pending') return res.status(409).json({ error: r.status === 'expired' ? 'This request has expired' : 'Another mechanic already took this job' });
    if (!getUser(u.id).verified) return res.status(403).json({ error: 'Your account is awaiting admin certification' });
  } else if (r.mechanic_id !== u.id || !flow[r.status]?.includes(s)) return res.status(400).json({ error: 'Invalid status change' });
  db.prepare('UPDATE requests SET status=?, mechanic_id=COALESCE(mechanic_id,?) WHERE id=?').run(s, s === 'accepted' ? u.id : null, r.id);
  const upd = getReq(r.id);
  [upd.motorist_id, upd.mechanic_id].filter(Boolean).forEach(id => emit(id, { type: 'request_update', request: upd }));
  if (u.role === 'mechanic') {
    const msg = { accepted: 'A mechanic accepted your request', enroute: 'Your mechanic is on the way', arrived: 'Your mechanic has arrived', completed: 'Service completed. Please settle payment.' }[s];
    notifyPush(r.motorist_id, { title: 'FleetCare', body: msg });
    notifyEmail(getUser(r.motorist_id).email, 'FleetCare update', msg);
  }
  res.json(upd);
});
const setArchived = val => (req, res) => {
  const r = getReq(req.params.id);
  if (!r || (req.user.role !== 'admin' && r.motorist_id !== req.user.id)) return res.status(404).json({ error: 'Request not found' });
  db.prepare(`UPDATE requests SET deleted_at=${val ? "datetime('now')" : 'NULL'} WHERE id=?`).run(r.id);
  res.json({ archived: val });
};
app.delete('/api/requests/:id', auth(['motorist', 'admin']), setArchived(true));
app.post('/api/requests/:id/restore', auth(['motorist', 'admin']), setArchived(false));

// UC-05 rate mechanic
app.post('/api/requests/:id/rate', auth(['motorist']), (req, res) => {
  const r = getReq(req.params.id), stars = Number(req.body.stars);
  if (!r || r.motorist_id !== req.user.id || r.status !== 'completed' || !r.mechanic_id) return res.status(400).json({ error: 'You can only rate a completed job' });
  if (!Number.isInteger(stars) || stars < 1 || stars > 5) return res.status(400).json({ error: 'Pick 1 to 5 stars' });
  try { db.prepare('INSERT INTO ratings(request_id,motorist_id,mechanic_id,stars,comment) VALUES(?,?,?,?,?)').run(r.id, req.user.id, r.mechanic_id, stars, String(req.body.comment || '').slice(0, 300)); }
  catch { return res.status(409).json({ error: 'You already rated this job' }); }
  notifyPush(r.mechanic_id, { title: 'New rating', body: `${stars} star${stars > 1 ? 's' : ''} from a motorist` });
  res.json({ ok: true });
});

// ---- payments (Stripe Checkout, sandbox keys)
app.post('/api/requests/:id/checkout', auth(['motorist']), async (req, res) => {
  const r = getReq(req.params.id);
  if (!r || r.motorist_id !== req.user.id || r.paid) return res.status(400).json({ error: 'Nothing to pay' });
  if (!stripe) { db.prepare('UPDATE requests SET paid=1 WHERE id=?').run(r.id); return res.json({ mock: true }); }
  const item = (name, amt) => ({ quantity: 1, price_data: { currency: 'php', unit_amount: amt * 100, product_data: { name } } });
  const s = await stripe.checkout.sessions.create({
    mode: 'payment', payment_method_types: ['card'],
    line_items: [item('Roadside dispatch support fee', r.support_fee), item(`Repair service (${r.severity})`, r.main_fee)],
    success_url: `${CLIENT}/?paid=${r.id}&session_id={CHECKOUT_SESSION_ID}`, cancel_url: CLIENT
  });
  db.prepare('UPDATE requests SET stripe_session=? WHERE id=?').run(s.id, r.id);
  res.json({ url: s.url });
});
app.post('/api/requests/:id/confirm', auth(['motorist']), async (req, res) => {
  const r = getReq(req.params.id);
  if (!r || r.motorist_id !== req.user.id || !stripe || r.stripe_session !== req.body.session_id) return res.status(400).json({ error: 'Invalid payment session' });
  const paid = (await stripe.checkout.sessions.retrieve(r.stripe_session)).payment_status === 'paid';
  if (paid) { db.prepare('UPDATE requests SET paid=1 WHERE id=?').run(r.id); notifyEmail(getUser(r.motorist_id).email, 'FleetCare receipt', `Payment received for request #${r.id}.`); }
  res.json({ paid });
});

// ---- chat history + push
app.get('/api/requests/:id/messages', auth(), (req, res) => {
  const r = getReq(req.params.id);
  if (!r || ![r.motorist_id, r.mechanic_id].includes(req.user.id)) return res.status(403).json({ error: 'Forbidden' });
  res.json(db.prepare('SELECT * FROM messages WHERE request_id=? ORDER BY id').all(r.id));
});
app.get('/api/push/key', (_, res) => res.json({ key: process.env.VAPID_PUBLIC || null }));
app.post('/api/push/subscribe', auth(), (req, res) => {
  db.prepare('INSERT OR REPLACE INTO push_subs(endpoint,user_id,sub) VALUES(?,?,?)').run(req.body.endpoint, req.user.id, JSON.stringify(req.body));
  res.json({ ok: true });
});

// ---- WebSocket: real-time chat + live mechanic location
const wss = new WebSocketServer({ server, path: '/ws' });
wss.on('connection', (ws, req) => {
  let u;
  try { u = jwt.verify(new URL(req.url, 'http://x').searchParams.get('token'), SECRET); } catch { return ws.close(4401); }
  if (!socks.has(u.id)) socks.set(u.id, new Set());
  socks.get(u.id).add(ws);
  ws.on('close', () => socks.get(u.id)?.delete(ws));
  ws.on('message', raw => {
    let m, r; try { m = JSON.parse(raw); r = getReq(m.requestId ?? null); } catch { return; }
    if (!r || !r.mechanic_id || ![r.motorist_id, r.mechanic_id].includes(u.id)) return;
    const other = u.id === r.motorist_id ? r.mechanic_id : r.motorist_id;
    if (m.type === 'chat' && typeof m.body === 'string' && m.body.trim()) {
      const id = db.prepare('INSERT INTO messages(request_id,sender_id,body) VALUES(?,?,?)').run(r.id, u.id, m.body.trim().slice(0, 1000)).lastInsertRowid;
      const msg = { type: 'chat', ...db.prepare('SELECT * FROM messages WHERE id=?').get(id), sender_name: u.name };
      emit(u.id, msg); emit(other, msg);
      if (!socks.get(other)?.size) notifyPush(other, { title: `Message from ${u.name}`, body: m.body.slice(0, 80) });
    }
    if (m.type === 'location' && u.role === 'mechanic' && r.mechanic_id === u.id && typeof m.lat === 'number' && typeof m.lng === 'number') {
      db.prepare('UPDATE users SET lat=?,lng=? WHERE id=?').run(m.lat, m.lng, u.id);
      emit(r.motorist_id, { type: 'location', requestId: r.id, lat: m.lat, lng: m.lng });
    }
  });
});
setInterval(() => { try { expireStale(); } catch (e) { console.error('[expire]', e.message); } }, 10_000).unref();
server.listen(process.env.PORT || 4000, () => console.log('FleetCare API on :' + (process.env.PORT || 4000)));
