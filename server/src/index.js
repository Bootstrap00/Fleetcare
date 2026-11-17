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
  (SELECT stars FROM ratings WHERE request_id=r.id) my_rating,
  (SELECT comment FROM ratings WHERE request_id=r.id) my_comment,
  (SELECT group_concat(id) FROM photos WHERE request_id=r.id AND source='review') review_photo_ids,
  (SELECT id FROM payments WHERE request_id=r.id ORDER BY id DESC LIMIT 1) payment_id,
  (SELECT reference FROM payments WHERE request_id=r.id ORDER BY id DESC LIMIT 1) payment_reference,
  (SELECT provider_session IS NOT NULL FROM payments WHERE request_id=r.id ORDER BY id DESC LIMIT 1) payment_online,
  (SELECT provider_url FROM payments WHERE request_id=r.id ORDER BY id DESC LIMIT 1) payment_url
  FROM requests r LEFT JOIN users m ON m.id=r.mechanic_id LEFT JOIN users u ON u.id=r.motorist_id`;

// ---- notifications: ONE place for in-app (saved + live over WebSocket), browser push and email.
// `page` is the page inside the person's own portal, e.g. '/track' -> /motorist/track.
// email/push can be turned off per event, and people can switch them off in their profile (in-app is always kept).
function notify(uid, { type, title, body = '', page = '', email = true, push = true }) {
  const u = getUser(uid);
  if (!u || u.deleted_at) return;
  const link = `/${u.role}${page}`, url = `${CLIENT}/#${link}`;
  const id = Number(db.prepare('INSERT INTO notifications(user_id,type,title,body,link) VALUES(?,?,?,?,?)').run(uid, type, title, body, link).lastInsertRowid);
  emit(uid, { type: 'notification', notification: { id, type, title, body, link, read: 0, created_at: new Date().toISOString().slice(0, 19).replace('T', ' ') } });
  if (push && u.notify_push !== 0) notifyPush(uid, { title, body, url });
  if (email && u.notify_email !== 0) notifyEmail(u.email, title, body, { label: 'Open FleetCare', url });
}

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
    notify(r.motorist_id, { type: 'expired', title: 'No mechanic available', body: `No mechanic accepted request #${r.id} within ${TIMEOUT_MIN} minutes. Resend it from My requests, ideally with a wider radius.`, page: '/orders' });
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
    if (role === 'mechanic') db.prepare("SELECT id FROM users WHERE role='admin' AND deleted_at IS NULL").all().forEach(a => notify(a.id, { type: 'mechanic_signup', title: 'Mechanic awaiting certification', body: `${name} (${email.toLowerCase()}) registered as a mechanic.`, page: '/users' }));
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
  // No role is sent on login: the account's own role (motorist, mechanic or admin) decides which dashboard opens.
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
  res.json({ id: u.id, name: u.name, role: u.role, email: u.email, phone: u.phone, avatar_at: u.avatar_at, bio: u.bio, notify_email: u.notify_email !== 0, notify_push: u.notify_push !== 0, created_at: u.created_at, verified: !!u.verified, ...db.prepare(`SELECT
    (SELECT ROUND(AVG(stars),1) FROM ratings WHERE mechanic_id=?) rating,
    (SELECT COUNT(*) FROM requests WHERE mechanic_id=? AND status='completed') jobs,
    (SELECT COALESCE(SUM(main_fee),0) FROM requests WHERE mechanic_id=? AND paid=1) earned`).get(u.id, u.id, u.id) });
});

// ---- profile (all roles): details, password, photo
app.patch('/api/profile', auth(), (req, res) => {
  const u = getUser(req.user.id);
  const name = String(req.body.name ?? u.name).trim().slice(0, 80), phone = String(req.body.phone ?? u.phone ?? '').trim().slice(0, 30);
  const bio = String(req.body.bio ?? u.bio ?? '').trim().slice(0, 300);
  const email = String(req.body.email ?? u.email).trim().toLowerCase();
  if (!name) return res.status(400).json({ error: 'Name cannot be empty' });
  if (!/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ error: 'Enter a valid email address' });
  try { db.prepare('UPDATE users SET name=?,phone=?,email=?,bio=? WHERE id=?').run(name, phone || null, email, bio || null, u.id); }
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
  const was = getUser(req.params.id)?.verified;
  db.prepare("UPDATE users SET verified=? WHERE id=? AND role='mechanic'").run(req.body.verified ? 1 : 0, req.params.id);
  if (req.body.verified && !was && getUser(req.params.id)?.role === 'mechanic') notify(Number(req.params.id), { type: 'certified', title: 'You are now a certified mechanic', body: 'An administrator certified your account. You can now accept jobs.', page: '/jobs' });
  res.json({ ok: true });
});
// ---- in-app notifications (the bell), preferences, push test
app.get('/api/notifications', auth(), (req, res) => res.json({
  items: db.prepare('SELECT id,type,title,body,link,read,created_at FROM notifications WHERE user_id=? ORDER BY id DESC LIMIT 30').all(req.user.id),
  unread: db.prepare('SELECT COUNT(*) n FROM notifications WHERE user_id=? AND read=0').get(req.user.id).n }));
app.post('/api/notifications/read', auth(), (req, res) => { // body.ids = some of them, or nothing = all
  if (Array.isArray(req.body.ids)) req.body.ids.map(Number).filter(Number.isInteger).forEach(id => db.prepare('UPDATE notifications SET read=1 WHERE id=? AND user_id=?').run(id, req.user.id));
  else db.prepare('UPDATE notifications SET read=1 WHERE user_id=?').run(req.user.id);
  res.json({ ok: true });
});
app.put('/api/profile/notifications', auth(), (req, res) => {
  db.prepare('UPDATE users SET notify_email=?, notify_push=? WHERE id=?').run(req.body.email === false ? 0 : 1, req.body.push === false ? 0 : 1, req.user.id);
  res.json({ ok: true });
});
app.post('/api/push/test', auth(), (req, res) => {
  notify(req.user.id, { type: 'test', title: 'Test notification', body: 'If you can see this, notifications are working.', email: false });
  res.json({ ok: true, push_configured: !!process.env.VAPID_PUBLIC });
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
    byMethod: all("SELECT method, COUNT(*) count, SUM(amount) amount FROM payments WHERE status='paid' GROUP BY method ORDER BY amount DESC"),
    paymentStatus: all('SELECT status, COUNT(*) count FROM payments GROUP BY status'),
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
  const head = ['id', 'created_at', 'motorist', 'mechanic', 'severity', 'status', 'issue', 'support_fee', 'main_fee', 'total', 'paid', 'payment_status', 'payment_method'];
  const csv = [head.join(','), ...rows.map(r => [r.id, r.created_at, r.motorist_name, r.mechanic_name, r.severity, r.status, r.issue, r.support_fee, r.main_fee, r.support_fee + r.main_fee, r.paid ? 'yes' : 'no', r.payment_status, r.payment_method].map(esc).join(','))].join('\n');
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
  mechs.forEach(m => notify(m.id, { type: 'new_request', title: 'Breakdown nearby', body: `${severity} issue within ${radius_km} km: ${issue || 'No description'}`, page: '/jobs' }));
  notify(req.user.id, { type: 'booking', title: `Booking confirmed: request #${id}`, body: `We alerted ${mechs.length} mechanic(s) within ${radius_km} km, and every mechanic can see your request. Estimated total: ${peso(FEES.support + FEES.main[severity])}.`, page: '/track' });
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
    notify(r.motorist_id, { type: 'status', title: msg, body: `Request #${r.id}: ${msg}.`.replace('..', '.'), page: s === 'completed' ? '/orders' : '/track' });
  } else if (upd.mechanic_id) notify(upd.mechanic_id, { type: 'cancelled', title: `Request #${r.id} was cancelled`, body: 'The motorist cancelled this request.', page: '/jobs' });
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
  try { db.prepare('INSERT INTO ratings(request_id,motorist_id,mechanic_id,stars,comment) VALUES(?,?,?,?,?)').run(r.id, req.user.id, r.mechanic_id, stars, String(req.body.comment || '').trim().slice(0, 500)); }
  catch { return res.status(409).json({ error: 'You already rated this job' }); }
  const cm = String(req.body.comment || '').trim();
  notify(r.mechanic_id, { type: 'review', title: `New ${stars}-star review`, body: cm ? `“${cm.slice(0, 140)}”` : `A motorist rated you ${stars} star${stars > 1 ? 's' : ''} for request #${r.id}.`, page: '/jobs' });
  res.json({ ok: true });
});

// UC-05 (extended): photos of the finished work, attached to the motorist's own review (max 4)
const IMG_RE = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/;
const readImage = (dataUrl, maxKb = 400) => {
  const m = IMG_RE.exec(dataUrl || '');
  if (!m) return { error: 'Upload a JPG, PNG or WebP image' };
  const buf = Buffer.from(m[2], 'base64');
  return buf.length > maxKb * 1024 ? { error: `Image is too large (max ${maxKb} KB)` } : { mime: m[1], buf };
};
app.post('/api/requests/:id/review-photos', auth(['motorist']), (req, res) => {
  const r = getReq(req.params.id);
  if (!r || r.motorist_id !== req.user.id || r.status !== 'completed' || !r.mechanic_id) return res.status(400).json({ error: 'You can only add photos to a completed job' });
  if (!db.prepare('SELECT 1 FROM ratings WHERE request_id=?').get(r.id)) return res.status(400).json({ error: 'Rate the job first, then add photos' });
  if (db.prepare("SELECT COUNT(*) n FROM photos WHERE request_id=? AND source='review'").get(r.id).n >= 4) return res.status(400).json({ error: 'You can add up to 4 photos per review' });
  const img = readImage(req.body.image);
  if (img.error) return res.status(400).json({ error: img.error });
  const id = db.prepare("INSERT INTO photos(mechanic_id,request_id,source,caption,mime,data) VALUES(?,?,'review',?,?,?)").run(r.mechanic_id, r.id, String(req.body.caption || '').trim().slice(0, 120) || null, img.mime, img.buf).lastInsertRowid;
  res.json({ id: Number(id) });
});
app.get('/api/photos/:id', (req, res) => { // public: <img> tags cannot send auth headers
  const p = db.prepare('SELECT mime,data FROM photos WHERE id=?').get(req.params.id);
  if (!p) return res.status(404).end();
  res.type(p.mime).set('Cache-Control', 'public, max-age=31536000, immutable').send(Buffer.from(p.data));
});
app.delete('/api/photos/:id', auth(), (req, res) => { // the motorist who posted it, the mechanic who owns a portfolio photo, or an admin
  const p = db.prepare('SELECT id,mechanic_id,request_id,source FROM photos WHERE id=?').get(req.params.id);
  if (!p) return res.status(404).json({ error: 'Photo not found' });
  const owner = p.source === 'review' ? getReq(p.request_id)?.motorist_id : p.mechanic_id;
  if (req.user.role !== 'admin' && owner !== req.user.id) return res.status(403).json({ error: 'You can only delete your own photos' });
  db.prepare('DELETE FROM photos WHERE id=?').run(p.id);
  res.json({ ok: true });
});

// ---- public "Browse mechanics": only certified, active mechanics; never exposes email or phone
const MECH_SQL = `SELECT u.id,u.name,u.avatar_at,u.bio,u.created_at,
  (SELECT ROUND(AVG(stars),1) FROM ratings WHERE mechanic_id=u.id) rating,
  (SELECT COUNT(*) FROM ratings WHERE mechanic_id=u.id) reviews,
  (SELECT COUNT(*) FROM requests WHERE mechanic_id=u.id AND status='completed') jobs,
  (SELECT COUNT(*) FROM photos WHERE mechanic_id=u.id) photo_count
  FROM users u WHERE u.role='mechanic' AND u.verified=1 AND u.deleted_at IS NULL`;
const shortName = n => { const [a, ...b] = String(n).trim().split(/\s+/); return b.length ? `${a} ${b[b.length - 1][0].toUpperCase()}.` : a; };
app.get('/api/mechanics', (req, res) => {
  const q = String(req.query.q || '').trim().toLowerCase(), limit = Math.min(Number(req.query.limit) || 24, 60);
  const order = { rating: 'rating DESC, reviews DESC, jobs DESC', jobs: 'jobs DESC, rating DESC', new: 'u.id DESC' }[req.query.sort] || 'rating DESC, reviews DESC, jobs DESC';
  const pics = db.prepare('SELECT id,source,caption FROM photos WHERE mechanic_id=? ORDER BY id DESC LIMIT 6');
  res.json(db.prepare(`${MECH_SQL} ORDER BY ${order}`).all()
    .filter(m => !q || `${m.name} ${m.bio || ''}`.toLowerCase().includes(q)).slice(0, limit)
    .map(m => ({ ...m, photos: pics.all(m.id) })));
});
// Home-page feed: latest motorist reviews (stars, comment, photos) with the mechanic's completed-job count. Public.
app.get('/api/reviews/recent', (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 6, 24);
  const ph = db.prepare("SELECT id FROM photos WHERE request_id=? AND source='review' ORDER BY id");
  res.json(db.prepare(`SELECT r.request_id id, r.stars, r.comment, r.created_at, mo.name motorist_name, mo.id motorist_id, mo.avatar_at motorist_avatar,
      m.id mechanic_id, m.name mechanic_name, m.avatar_at mechanic_avatar,
      (SELECT ROUND(AVG(stars),1) FROM ratings WHERE mechanic_id=m.id) mechanic_rating,
      (SELECT COUNT(*) FROM requests WHERE mechanic_id=m.id AND status='completed') mechanic_jobs
    FROM ratings r JOIN users mo ON mo.id=r.motorist_id JOIN users m ON m.id=r.mechanic_id
    WHERE m.role='mechanic' AND m.verified=1 AND m.deleted_at IS NULL ORDER BY r.rowid DESC LIMIT ?`).all(limit)
    .map(({ motorist_name, ...r }) => ({ ...r, motorist: shortName(motorist_name), photos: ph.all(r.id).map(p => p.id) })));
});
app.get('/api/mechanics/:id', (req, res) => {
  const m = db.prepare(`${MECH_SQL} AND u.id=?`).get(req.params.id);
  if (!m) return res.status(404).json({ error: 'Mechanic not found' });
  res.json({ ...m, photos: db.prepare('SELECT id,source,caption,created_at FROM photos WHERE mechanic_id=? ORDER BY id DESC LIMIT 60').all(m.id) });
});
app.get('/api/mechanics/:id/reviews', (req, res) => {
  if (!db.prepare(`${MECH_SQL} AND u.id=?`).get(req.params.id)) return res.status(404).json({ error: 'Mechanic not found' });
  const ph = db.prepare("SELECT id FROM photos WHERE request_id=? AND source='review' ORDER BY id");
  res.json(db.prepare(`SELECT r.request_id id, r.stars, r.comment, r.created_at, u.name, u.id reviewer_id, u.avatar_at reviewer_avatar
    FROM ratings r JOIN users u ON u.id=r.motorist_id WHERE r.mechanic_id=? ORDER BY r.rowid DESC LIMIT 50`).all(req.params.id)
    .map(({ name, ...r }) => ({ ...r, reviewer: shortName(name), photos: ph.all(r.id).map(p => p.id) })));
});
// the mechanic's own portfolio (photos of previous work), max 24
app.get('/api/portfolio', auth(['mechanic']), (req, res) => res.json(db.prepare("SELECT id,caption,created_at FROM photos WHERE mechanic_id=? AND source='portfolio' ORDER BY id DESC").all(req.user.id)));
app.post('/api/portfolio', auth(['mechanic']), (req, res) => {
  if (db.prepare("SELECT COUNT(*) n FROM photos WHERE mechanic_id=? AND source='portfolio'").get(req.user.id).n >= 24) return res.status(400).json({ error: 'Your portfolio is full (24 photos). Delete one to add another.' });
  const img = readImage(req.body.image);
  if (img.error) return res.status(400).json({ error: img.error });
  const id = db.prepare("INSERT INTO photos(mechanic_id,source,caption,mime,data) VALUES(?,'portfolio',?,?,?)").run(req.user.id, String(req.body.caption || '').trim().slice(0, 120) || null, img.mime, img.buf).lastInsertRowid;
  res.json({ id: Number(id) });
});

// ---- payments: cash, GCash, Maya, card (Stripe) and bank transfer. Status: pending | paid | failed
const PAY = {
  cash: ['Cash on Service', 'Pay your mechanic in cash when the job is done. They confirm they received it.'],
  gcash: ['GCash', 'Send the total to the GCash account below, then enter the reference number from your receipt.'],
  maya: ['Maya', 'Send the total to the Maya account below, then enter the reference number from your receipt.'],
  card: ['Credit / Debit Card', 'Pay securely by card.'],
  bank: ['Bank Transfer', 'Transfer the total to the bank account below, then enter the transaction reference number.'],
};
const REF_METHODS = ['gcash', 'maya', 'bank'];
// Real online payments. PayMongo (Philippines) handles GCash, Maya and cards: the motorist is sent to the provider
// (the GCash / Maya app on a phone), pays there, and FleetCare marks it paid itself. No mechanic confirmation needed.
// Without a gateway key: card is not offered (no fake payments) and GCash / Maya fall back to manual transfer + reference.
const PM_KEY = process.env.PAYMONGO_SECRET_KEY || '';
const PM_TYPE = { gcash: 'gcash', maya: 'paymaya', card: 'card' };
const pm = async (method, path, body) => {
  const r = await fetch('https://api.paymongo.com/v1' + path, { method, headers: { 'Content-Type': 'application/json', Authorization: 'Basic ' + Buffer.from(PM_KEY + ':').toString('base64') }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.errors?.[0]?.detail || `Payment provider error (${r.status})`);
  return j.data;
};
const onlineVia = m => (m === 'card' ? (PM_KEY ? 'paymongo' : stripe ? 'stripe' : null) : PM_TYPE[m] && PM_KEY ? 'paymongo' : null);
const payMethods = () => (process.env.PAY_METHODS || 'cash,gcash,maya,card,bank').split(',').map(s => s.trim()).filter(m => PAY[m] && (m !== 'card' || onlineVia('card')));
const peso = n => '₱' + Number(n).toLocaleString();
app.get('/api/payment-options', (_, res) => {
  const e = process.env;
  const details = { gcash: { name: e.GCASH_NAME || 'FleetCare', number: e.GCASH_NUMBER || '0917 000 0000' }, maya: { name: e.MAYA_NAME || 'FleetCare', number: e.MAYA_NUMBER || '0918 000 0000' },
    bank: { bank: e.BANK_NAME || 'BDO', name: e.BANK_ACCOUNT_NAME || 'FleetCare Inc.', number: e.BANK_ACCOUNT_NUMBER || '0000 0000 0000' } };
  res.json({ card_mode: onlineVia('card'), methods: payMethods().map(id => { const online = !!onlineVia(id) && id !== 'cash';
    return { id, label: PAY[id][0], online, needs_reference: REF_METHODS.includes(id) && !online, details: online ? null : details[id] || null,
      hint: online ? (id === 'card' ? 'Pay securely by card on the next page.' : `You will be taken to ${PAY[id][0]} to approve the payment. It is confirmed automatically.`) : PAY[id][1] }; }) });
});
// The booking always shows the paid flag + the latest payment status/method; both people get a live refresh.
function syncPayment(requestId) {
  const rows = db.prepare('SELECT status,method FROM payments WHERE request_id=? ORDER BY id DESC').all(requestId);
  const paid = rows.find(p => p.status === 'paid'), last = paid || rows[0];
  db.prepare('UPDATE requests SET paid=?, payment_status=?, payment_method=? WHERE id=?').run(paid ? 1 : 0, last ? last.status : 'pending', last ? last.method : null, requestId);
  const upd = getReq(requestId);
  [upd.motorist_id, upd.mechanic_id].filter(Boolean).forEach(id => emit(id, { type: 'request_update', request: upd }));
  return upd;
}
function settle(p, status, by, note, silent) { // pending -> paid | failed
  db.prepare("UPDATE payments SET status=?, confirmed_by=?, note=COALESCE(?,note), updated_at=datetime('now') WHERE id=?").run(status, by ?? null, note ?? null, p.id);
  const r = syncPayment(p.request_id), mot = getUser(r.motorist_id);
  if (silent) return r;
  if (status === 'paid') notify(mot.id, { type: 'payment', title: `Payment received: request #${r.id}`, page: '/orders',
    body: `Thank you! Request #${r.id} (${r.severity})\nDispatch support fee: ${peso(r.support_fee)}\nService fee: ${peso(r.main_fee)}\nTotal paid: ${peso(p.amount)}\nMethod: ${PAY[p.method][0]}${p.reference ? `\nReference: ${p.reference}` : ''}` });
  if (status === 'paid' && p.provider_session && r.mechanic_id) notify(r.mechanic_id, { type: 'payment', title: `Paid online: request #${r.id}`, page: '/jobs', push: true, email: false, body: `${mot.name} paid ${peso(p.amount)} by ${PAY[p.method][0]}. Nothing to confirm.` });
  if (status !== 'paid') notify(mot.id, { type: 'payment', title: `Payment not confirmed: request #${r.id}`, page: '/orders', body: `We could not confirm your ${PAY[p.method][0]} payment${note ? ` (${note})` : ''}. Please choose a payment method again.` });
  return r;
}
app.post('/api/requests/:id/pay', auth(['motorist']), async (req, res) => {
  const r = getReq(req.params.id), method = String(req.body.method || '');
  if (!r || r.motorist_id !== req.user.id || r.deleted_at) return res.status(404).json({ error: 'Request not found' });
  if (r.status !== 'completed') return res.status(400).json({ error: 'You can pay once the mechanic marks the job complete' });
  if (r.paid) return res.status(409).json({ error: 'This request is already paid' });
  if (!payMethods().includes(method)) return res.status(400).json({ error: 'Choose a payment method' });
  if (db.prepare("SELECT 1 FROM payments WHERE request_id=? AND status='pending'").get(r.id)) return res.status(409).json({ error: 'A payment is already waiting for confirmation. Cancel it first to choose another method.' });
  const reference = String(req.body.reference || '').trim().slice(0, 40), amount = r.support_fee + r.main_fee;
  if (REF_METHODS.includes(method) && !onlineVia(method) && reference.length < 6) return res.status(400).json({ error: 'Enter the transaction reference number (at least 6 characters)' });
  const add = (session, note) => Number(db.prepare('INSERT INTO payments(request_id,method,amount,reference,provider_session,note) VALUES(?,?,?,?,?,?)').run(r.id, method, amount, reference || null, session ?? null, note ?? null).lastInsertRowid);
  const via = method === 'cash' ? null : onlineVia(method);
  if (via) { // real online payment: send the motorist to the provider and wait for it to confirm
    const items = [['Roadside dispatch support fee', r.support_fee], [`Repair service (${r.severity})`, r.main_fee]].filter(x => x[1] > 0);
    const id = add(null);
    try {
      let sid, url;
      if (via === 'paymongo') {
        const s = await pm('POST', '/checkout_sessions', { data: { attributes: { send_email_receipt: false, show_description: true, show_line_items: true,
          description: `FleetCare request #${r.id}`, payment_method_types: [PM_TYPE[method]], reference_number: `FC-${r.id}-${id}`,
          line_items: items.map(([name, amt]) => ({ name, amount: amt * 100, currency: 'PHP', quantity: 1 })),
          success_url: `${CLIENT}/?paid=${r.id}&pid=${id}`, cancel_url: `${CLIENT}/?paid=${r.id}&pid=${id}` } } });
        sid = s.id; url = s.attributes.checkout_url;
      } else {
        const item = (name, amt) => ({ quantity: 1, price_data: { currency: 'php', unit_amount: amt * 100, product_data: { name } } });
        const s = await stripe.checkout.sessions.create({ mode: 'payment', payment_method_types: ['card'], line_items: items.map(([n, a]) => item(n, a)),
          success_url: `${CLIENT}/?paid=${r.id}&pid=${id}`, cancel_url: `${CLIENT}/?paid=${r.id}&pid=${id}` });
        sid = s.id; url = s.url;
      }
      db.prepare('UPDATE payments SET provider_session=?, provider_url=? WHERE id=?').run(sid, url, id);
      syncPayment(r.id);
      return res.json({ url, payment_id: id, status: 'pending' });
    } catch (e) { db.prepare("UPDATE payments SET status='failed', note=? WHERE id=?").run(String(e.message).slice(0, 200), id); syncPayment(r.id); return res.status(502).json({ error: e.message }); }
  }
  const id = add(null);
  syncPayment(r.id); // cash / e-wallet / bank: stays pending until the mechanic confirms they received the money
  if (r.mechanic_id) {
    notify(r.mechanic_id, { type: 'payment_due', title: `Confirm payment: request #${r.id}`, page: '/jobs', body: `${getUser(r.motorist_id).name} chose ${PAY[method][0]} for ${peso(amount)}${reference ? ` (reference ${reference})` : ''}. Confirm once you have received it.` });
    notify(r.motorist_id, { type: 'payment', title: `Payment submitted: request #${r.id}`, page: '/orders', email: false, push: false, body: `Waiting for ${getUser(r.mechanic_id).name} to confirm your ${PAY[method][0]} payment.` });
  }
  res.json({ payment_id: id, status: 'pending' });
});
// Ask the provider whether an online payment went through, and settle it. Used on return, by the button, and by the background check.
async function checkOnline(p) {
  if (p.status !== 'pending' || !p.provider_session) return p.status;
  try {
    if (stripe && /^cs_(test|live)_/.test(p.provider_session)) { // Stripe ids look like cs_test_…; PayMongo ids are plain cs_…
      const s = await stripe.checkout.sessions.retrieve(p.provider_session);
      if (s.payment_status === 'paid') settle(p, 'paid', null); else if (s.status === 'expired') settle(p, 'failed', null, 'Checkout expired');
    } else if (PM_KEY) {
      const s = await pm('GET', '/checkout_sessions/' + p.provider_session), at = s.attributes;
      if ((at.payments || []).some(x => x.attributes?.status === 'paid') || at.payment_intent?.attributes?.status === 'succeeded') settle(p, 'paid', null);
      else if (at.status === 'expired') settle(p, 'failed', null, 'Checkout expired');
    }
  } catch (e) { console.error('[payment check]', e.message); }
  return db.prepare('SELECT status FROM payments WHERE id=?').get(p.id).status;
}
app.post('/api/requests/:id/confirm', auth(['motorist']), async (req, res) => { // motorist came back from the provider (or pressed "Check payment")
  const r = getReq(req.params.id), pid = Number(req.body.pid) || null, sid = String(req.body.session_id || '');
  const p = r && (pid ? db.prepare('SELECT * FROM payments WHERE id=? AND request_id=?').get(pid, r.id) : db.prepare('SELECT * FROM payments WHERE request_id=? AND provider_session=?').get(r.id, sid));
  if (!p || r.motorist_id !== req.user.id || !p.provider_session) return res.status(400).json({ error: 'Invalid payment session' });
  const status = await checkOnline(p);
  res.json({ paid: status === 'paid', status });
});
// Safety net: if the motorist pays in the GCash / Maya app and never returns to FleetCare, we still find out.
setInterval(async () => {
  for (const p of db.prepare("SELECT * FROM payments WHERE status='pending' AND provider_session IS NOT NULL AND created_at > datetime('now','-3 hours')").all()) await checkOnline(p);
}, 15_000).unref();
app.post('/api/payments/:id/cancel', auth(['motorist']), (req, res) => { // the motorist changes their mind while a payment is pending
  const p = db.prepare('SELECT * FROM payments WHERE id=?').get(req.params.id), r = p && getReq(p.request_id);
  if (!p || r.motorist_id !== req.user.id) return res.status(404).json({ error: 'Payment not found' });
  if (p.status !== 'pending') return res.status(409).json({ error: 'This payment is already settled' });
  res.json(settle(p, 'failed', req.user.id, 'Cancelled by the motorist', true));
});
app.post('/api/payments/:id/confirm', auth(['mechanic', 'admin']), (req, res) => { // mechanic (or admin) confirms they received the money, or marks it failed
  const p = db.prepare('SELECT * FROM payments WHERE id=?').get(req.params.id), r = p && getReq(p.request_id);
  if (!p) return res.status(404).json({ error: 'Payment not found' });
  if (req.user.role === 'mechanic' && r.mechanic_id !== req.user.id) return res.status(403).json({ error: 'Only the mechanic on this job can confirm payment' });
  if (p.status !== 'pending') return res.status(409).json({ error: 'This payment is already settled' });
  if (p.provider_session) return res.status(400).json({ error: 'Card payments are confirmed automatically by the card processor' });
  res.json(settle(p, req.body.paid ? 'paid' : 'failed', req.user.id, String(req.body.note || '').trim().slice(0, 200) || null));
});
app.get('/api/payments', auth(['admin']), (_, res) => res.json(db.prepare(`SELECT p.*, r.severity, mo.name motorist_name, me.name mechanic_name FROM payments p
  JOIN requests r ON r.id=p.request_id LEFT JOIN users mo ON mo.id=r.motorist_id LEFT JOIN users me ON me.id=r.mechanic_id ORDER BY p.id DESC LIMIT 200`).all()));

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
      if (!socks.get(other)?.size) notifyPush(other, { title: `Message from ${u.name}`, body: m.body.slice(0, 80), url: `${CLIENT}/#/${getUser(other).role}/track` });
    }
    if (m.type === 'location' && u.role === 'mechanic' && r.mechanic_id === u.id && typeof m.lat === 'number' && typeof m.lng === 'number') {
      db.prepare('UPDATE users SET lat=?,lng=? WHERE id=?').run(m.lat, m.lng, u.id);
      emit(r.motorist_id, { type: 'location', requestId: r.id, lat: m.lat, lng: m.lng });
    }
  });
});
setInterval(() => { try { expireStale(); } catch (e) { console.error('[expire]', e.message); } }, 10_000).unref();
server.listen(process.env.PORT || 4000, () => console.log('FleetCare API on :' + (process.env.PORT || 4000)));
