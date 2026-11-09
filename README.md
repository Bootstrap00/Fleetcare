# FleetCare: roadside assistance platform

Node.js API + React PWA + Directus CMS. Motorists pin a breakdown and broadcast a distress radius; certified mechanics inside the radius get a push/email alert, every mechanic can view open requests (nearest first, with an in-range / outside-range note), the first certified mechanic to accept gets the job, chat, share live location, and get paid through Stripe sandbox.

Requires **Node.js 22.5 or newer** (works on the latest Node, including 25). SQLite is built into Node, so there is nothing to compile.

## Separate portals (one login page and one workspace per role)
| Portal | Sign in | Workspace |
|---|---|---|
| Motorist | http://localhost:5173/#/login/motorist | `/#/motorist` (dashboard, request help, live tracking, my requests) |
| Mechanic | http://localhost:5173/#/login/mechanic | `/#/mechanic` (dashboard, jobs, live job) |
| Administrator | http://localhost:5173/#/login/admin | `/#/admin` (dashboard, requests, users, fees, content, reports) |

`/#/login` shows a chooser for all three. A motorist account cannot sign in through the mechanic or admin portal (the API rejects it),
and a signed-in user who opens another role's URL is sent back to their own portal. Admin has no public sign-up; the default admin is below.
Each portal has its own accent color (motorist amber, mechanic green, admin violet).

## Account security and request timeout
- **Login lockout:** 5 wrong passwords for an email (from the same device) locks sign-in for 30 seconds. The login page shows attempts left and a countdown.
  Change with `LOGIN_MAX_ATTEMPTS` and `LOGIN_LOCK_SECONDS` in `server/.env`. The counter is kept in memory, so restarting the API clears it.
- **Forgot password:** "Forgot password?" on every login page (including admin) emails a one-time link valid for 30 minutes (`/#/reset/<token>`).
  A new link cancels older ones, and a successful reset also lifts any login lock. Reset emails are limited to 3 per minute per email.
  Links use `CLIENT_URL` from `server/.env` (set it to `http://localhost:4173` if you use `npm run preview`).
  **Development mode:** when `SMTP_HOST` is empty, the page shows the reset link directly so you can test without email. With SMTP configured, the link is only sent by email.
  Existing logged-in sessions are not signed out by a password reset.
- **Request timeout:** a request that no mechanic accepts within `REQUEST_TIMEOUT_MIN` minutes (default 10) becomes **expired**. The motorist gets a live update, push notification and email,
  sees a countdown while waiting, and can **Resend** with a radius 10 km wider. Mechanics can no longer accept it. Reports count expired requests.

## Logo and branding
The logo is a map pin (breakdown location) with a gear (mechanic) and radar ripples (distress radius). Files are in `branding/`:
`fleetcare-mark.svg` / `-light.svg` (icon only), `fleetcare-logo-dark.svg` / `-light.svg` (with wordmark), `fleetcare-app-icon.svg`, PNG exports, and `brand-sheet.png`.
Colors: Signal amber `#FFB800`, Radar cyan `#3DF5FF`, Deep space `#05070D`, Cloud `#EAF1FF`. Font: Space Grotesk.
The app shows it beside the FleetCare name in the navbar (every page), login pages, landing page, footer, the loading screen, and in the emails the system sends (embedded, so no hosting is needed).
To brand the Directus CMS too: Settings > Project Settings > Branding, upload `branding/fleetcare-mark.svg` as the logo and set the color to `#FFB800`. Stripe's checkout page is branded in the Stripe dashboard (Settings > Branding).
The app uses it in the navbar, footer, browser tab icon and the installable PWA icons (`client/public`).

## Profiles (all three roles)
Every portal has a **My profile** page (click your avatar in the navbar, or `/#/motorist/profile`, `/#/mechanic/profile`, `/#/admin/profile`):
edit name, phone and email, upload or remove a profile photo (auto-cropped to a square, stored in the database), and change your password.
Photos show next to names in the navbar, request cards, tracking and the admin user list. This is also how you change the default admin password.

## Run it (VS Code terminal, from the project root)
```bash
npm run setup     # creates .env files and installs everything (once)
npm run dev       # API on :4000 + web app on :5173
```
Open http://localhost:5173. Default admin: `admin@fleetcare.local` / `admin123` (change it).

## Test the PWA offline mode
```bash
npm run build
npm run preview   # API + built app on http://localhost:4173
```
In Chrome DevTools > Application > Service Workers, tick Offline, send a request, untick Offline.

## CMS (Directus, needs Docker Desktop)
```bash
docker compose up        # http://localhost:8055  login: cms@fleetcare.local / ChangeMe123!
```
Start the API once first so the database exists. In Directus go to Settings > Data Model and click the untracked
`fee_schedule` and `announcements` collections to start managing them. Fee changes apply to the next request, and
published announcements show on every dashboard.

## Requirement checklist
| Requirement | Where |
|---|---|
| Node.js backend API | `server/src/index.js` |
| React frontend | `client/src` |
| PWA offline + background sync | `client/public/sw.js`, `manifest.webmanifest` |
| Push notifications | `server/src/notify.js`, `client/src/api.js` (`npm --prefix server run vapid` for keys) |
| Real-time chat via WebSocket | `/ws` in `index.js`, `client/src/Chat.jsx` |
| Database | SQLite (`server/data/fleetcare.db`), managed through Directus |
| CRUD + soft delete/archiving | `/api/requests`: create, read, **update (edit while pending)**, archive/restore |
| Directus CMS | `fee_schedule` and `announcements` tables edited in the CMS |
| Google Maps | `client/src/MapView.jsx` (`VITE_GOOGLE_MAPS_KEY` in `client/.env`) |
| Payments | Stripe Checkout sandbox (`STRIPE_SECRET_KEY` in `server/.env`): support fee + severity fee |
| Email (SMTP) | `server/src/notify.js` (Mailtrap or any SMTP) |

## Use-case coverage (from your diagram) and where to find each one
| UC | Feature | Page (navbar) |
|---|---|---|
| 01 · 02 | Pin breakdown location, submit assistance request (edit while pending) | Motorist: Request help |
| 03 | Track mechanic arrival (live map, distance, status stepper, chat) | Motorist / Mechanic: Live tracking |
| 04 | Pay support + main fees (Stripe sandbox) | My requests, Live tracking |
| 05 | Rate mechanic (1-5 stars + comment) | My requests, Live tracking |
| 06 | Register / log in | Get started |
| 07 · 08 · 09 | Receive and accept job, update status, complete job | Mechanic: Jobs |
| 10 | Manage users and mechanics (certify, deactivate/reactivate) | Admin: Users |
| 11 | Manage services and fees | Admin: Services and fees |
| 12 | Manage website content (homepage text, announcements) | Admin: Content |
| 13 | Generate reports (KPIs, charts, top mechanics, CSV export) | Admin: Reports |
| 14 | Email notifications (SMTP) | automatic, see `server/src/notify.js` |

Fees and homepage content can also be edited from Directus (`fee_schedule`, `site_content`, `announcements` tables).

## Fee model (PHP)
Default: support fee ₱150 (dispatch call) + minor ₱500 / moderate ₱1,500 / major ₱3,500. Edit in the `fee_schedule` table via Directus.

## Suggested split for the Major/Minor push rule
Major: UI + auth, real-time chat + location, notifications + PWA sync, requests CRUD + payments.
Minor: sidebar/styling, archive view, email templates, admin certification, README/docs.
