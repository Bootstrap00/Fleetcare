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
