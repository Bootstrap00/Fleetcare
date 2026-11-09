import nodemailer from 'nodemailer';
import webpush from 'web-push';
import { fileURLToPath } from 'node:url';
import db from './db.js';
const e = process.env;
const mailer = e.SMTP_HOST ? nodemailer.createTransport({ host: e.SMTP_HOST, port: +e.SMTP_PORT || 587, auth: { user: e.SMTP_USER, pass: e.SMTP_PASS } }) : null;
const LOGO = fileURLToPath(new URL('../assets/logo.png', import.meta.url));
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
// Branded email: logo (embedded, no external hosting needed) + name + message.
export const buildMail = (to, subject, text, action) => ({
  from: e.MAIL_FROM, to, subject, text: action ? `${text}\n\n${action.label}: ${action.url}` : text,
  html: `<div style="background:#05070d;padding:24px;font-family:'Segoe UI',Arial,sans-serif"><div style="max-width:520px;margin:0 auto;background:#0d1424;border:1px solid #1f2a44;border-radius:16px;padding:28px;color:#eaf1ff">
<table role="presentation" style="margin-bottom:18px"><tr><td><img src="cid:fleetcare-logo" width="48" height="48" alt="FleetCare" style="display:block"></td><td style="padding-left:12px;font-size:24px;font-weight:700">Fleet<span style="color:#ffb800">Care</span></td></tr></table>
<div style="font-size:15px;line-height:1.6;white-space:pre-line">${esc(text)}</div>${action ? `<a href="${esc(action.url)}" style="display:inline-block;margin-top:18px;padding:12px 24px;border-radius:999px;background:#ffb800;color:#150f00;text-decoration:none;font-weight:700">${esc(action.label)}</a><div style="margin-top:12px;font-size:12px;color:#8d9bb5;word-break:break-all">Or copy this link: ${esc(action.url)}</div>` : ''}
<div style="margin-top:24px;padding-top:14px;border-top:1px solid #1f2a44;font-size:12px;color:#8d9bb5">FleetCare · Roadside assistance</div></div></div>`,
  attachments: [{ filename: 'fleetcare-logo.png', path: LOGO, cid: 'fleetcare-logo' }]
});
export async function notifyEmail(to, subject, text, action) {
  if (!mailer) return console.log('[email:dev]', to, '|', subject, '|', text);
  try { await mailer.sendMail(buildMail(to, subject, text, action)); } catch (err) { console.error('[email]', err.message); }
}
const pushOn = e.VAPID_PUBLIC && e.VAPID_PRIVATE;
if (pushOn) webpush.setVapidDetails('mailto:admin@fleetcare.local', e.VAPID_PUBLIC, e.VAPID_PRIVATE);
export async function notifyPush(userId, payload) {
  if (!pushOn) return;
  for (const r of db.prepare('SELECT endpoint, sub FROM push_subs WHERE user_id=?').all(userId)) {
    try { await webpush.sendNotification(JSON.parse(r.sub), JSON.stringify(payload)); }
    catch (err) { if ([404, 410].includes(err.statusCode)) db.prepare('DELETE FROM push_subs WHERE endpoint=?').run(r.endpoint); }
  }
}
