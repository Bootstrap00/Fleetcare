import { DatabaseSync } from 'node:sqlite';
import fs from 'fs';
fs.mkdirSync('data', { recursive: true });
const db = new DatabaseSync(process.env.DB_FILE || 'data/fleetcare.db');
db.exec('PRAGMA journal_mode = WAL');
db.exec(`
CREATE TABLE IF NOT EXISTS users(
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL, password TEXT NOT NULL,
  phone TEXT, role TEXT NOT NULL, verified INTEGER DEFAULT 0, lat REAL, lng REAL,
  deleted_at TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS requests(
  id INTEGER PRIMARY KEY AUTOINCREMENT, motorist_id INTEGER NOT NULL, mechanic_id INTEGER,
  lat REAL NOT NULL, lng REAL NOT NULL, issue TEXT, severity TEXT NOT NULL, radius_km REAL DEFAULT 10,
  status TEXT DEFAULT 'pending', support_fee INTEGER, main_fee INTEGER, paid INTEGER DEFAULT 0,
  stripe_session TEXT, deleted_at TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS messages(
  id INTEGER PRIMARY KEY AUTOINCREMENT, request_id INTEGER NOT NULL, sender_id INTEGER NOT NULL,
  body TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS push_subs(endpoint TEXT PRIMARY KEY, user_id INTEGER NOT NULL, sub TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS password_resets(token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL, expires_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS ratings(request_id INTEGER PRIMARY KEY, motorist_id INTEGER NOT NULL, mechanic_id INTEGER NOT NULL, stars INTEGER NOT NULL, comment TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS site_content(key TEXT PRIMARY KEY, value TEXT);
-- CMS-managed content: edit these two tables in Directus (http://localhost:8055)
CREATE TABLE IF NOT EXISTS fee_schedule(code TEXT PRIMARY KEY, label TEXT, amount INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS announcements(id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, body TEXT, published INTEGER DEFAULT 1, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
`);
// profile photo columns (added later, so migrate older databases)
const userCols = db.prepare('PRAGMA table_info(users)').all().map(c => c.name);
for (const [n, t] of [['avatar', 'BLOB'], ['avatar_type', 'TEXT'], ['avatar_at', 'TEXT']]) if (!userCols.includes(n)) db.exec(`ALTER TABLE users ADD COLUMN ${n} ${t}`);

// ---- migrations: every block is safe to run on each start (IF NOT EXISTS / column checks) ----
// Helper for later migrations: add a column only if it is missing.
const addColumn = (table, col, def) => { if (!db.prepare(`PRAGMA table_info(${table})`).all().some(c => c.name === col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`); };
// Photos: review photos (source='review', tied to a request) and mechanic portfolio photos (source='portfolio').
db.exec(`
CREATE TABLE IF NOT EXISTS photos(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  mechanic_id INTEGER NOT NULL,
  request_id INTEGER,
  source TEXT NOT NULL,
  caption TEXT,
  mime TEXT NOT NULL,
  data BLOB NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX IF NOT EXISTS idx_photos_mechanic ON photos(mechanic_id, source);
CREATE INDEX IF NOT EXISTS idx_photos_request ON photos(request_id);
`);
// Mechanic bio shown on the public profile
addColumn('users', 'bio', 'TEXT');
// Payments: every attempt is a row (the transaction log); the booking keeps the latest status for quick display.
// status: pending | paid | failed      method: cash | gcash | maya | card | bank
db.exec(`
CREATE TABLE IF NOT EXISTS payments(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id INTEGER NOT NULL,
  method TEXT NOT NULL,
  amount INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  reference TEXT,
  provider_session TEXT,
  note TEXT,
  confirmed_by INTEGER,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX IF NOT EXISTS idx_payments_request ON payments(request_id);
`);
addColumn('payments', 'provider_url', 'TEXT');
addColumn('requests', 'payment_status', "TEXT DEFAULT 'pending'");
addColumn('requests', 'payment_method', 'TEXT');
// bookings that were paid before this migration keep their status and get a transaction record
db.exec(`
UPDATE requests SET payment_status='paid', payment_method=COALESCE(payment_method,'card') WHERE paid=1 AND payment_status<>'paid';
INSERT INTO payments(request_id,method,amount,status,note) SELECT id,'card',support_fee+main_fee,'paid','migrated from the old paid flag' FROM requests WHERE paid=1 AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.request_id=requests.id);
`);
// Notifications: saved for the in-app bell, plus per-user switches for email and browser push
db.exec(`
CREATE TABLE IF NOT EXISTS notifications(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  link TEXT,
  read INTEGER DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, read, id);
`);
addColumn('users', 'notify_email', 'INTEGER DEFAULT 1');
addColumn('users', 'notify_push', 'INTEGER DEFAULT 1');
// Service-based fee model (PHP). Defaults are seeded once; afterwards the CMS owns the amounts.
const seed = db.prepare('INSERT OR IGNORE INTO fee_schedule(code,label,amount) VALUES(?,?,?)');
[['support', 'Dispatch support fee (phone call)', 150], ['minor', 'Minor issue', 500], ['moderate', 'Moderate issue', 1500], ['major', 'Major issue', 3500]].forEach(r => seed.run(...r));
if (!db.prepare('SELECT 1 FROM announcements').get())
  db.prepare('INSERT INTO announcements(title,body) VALUES(?,?)').run('Welcome to FleetCare', 'Certified mobile mechanics are on standby. Pin your location to get help.');
export const CONTENT = {
  hero_title: 'Stranded? Help is already moving.',
  hero_sub: 'FleetCare connects stranded motorists with certified mobile mechanics in minutes. Pin your location, broadcast a distress radius and watch your mechanic arrive live.',
  cta_label: 'Request roadside help'
};
const seedC = db.prepare('INSERT OR IGNORE INTO site_content(key,value) VALUES(?,?)');
Object.entries(CONTENT).forEach(([k, v]) => seedC.run(k, v));
export const getFees = () => {
  const f = { support: 0, main: {} };
  for (const r of db.prepare('SELECT code,amount FROM fee_schedule').all()) r.code === 'support' ? (f.support = r.amount) : (f.main[r.code] = r.amount);
  return f;
};
export default db;
