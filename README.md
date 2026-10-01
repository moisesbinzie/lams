# LAMS — Lecture Attendance Monitoring System

Attend • Track • Succeed. QR + GPS attendance in seconds.

## System flow usage

### Students (no account)
1. Scan the QR code displayed in the lecture room (`/a/[sessionId]?t=TOKEN`).
2. Enter your registration number — name and student ID auto-fill from the roster (new students type all three once).
3. Allow location once — the phone sends GPS automatically with the submission.
4. See result immediately: Present (in range, on time), Late (in range, after Present window), Out of Range (outside radius).
5. Duplicate reg numbers per session are rejected. No dashboard, nothing to install.

### Class representatives (shared admin password + flagged rep identity)
1. Open the same QR link → `Rep mode` (`/a/[sessionId]/rep`).
2. Unlock with the shared admin password (default `admin123`, lecturer changes it).
3. Enter your own name + your own registration number (must be flagged as class rep on the roster) — your GPS is captured as the location proxy for the batch.
4. Add 2–50 rows: each student's full name + reg number + student ID. Submit once.
5. Result shows how many were added vs skipped (duplicates/incomplete/unauthorised). Every entry is tagged `method=rep` + rep name + rep reg for lecturer review. Only works while the session is open.

### Lecturers (shared admin password, no personal login)
1. Open `/lecturer`, unlock (first run seeds `admin123`), then change the password in Settings.
2. Create Term (name + start/end dates) → Course (code + title, linked to term).
3. Build roster: manual add (name + reg + student ID) and/or paste CSV (`Name, Reg, ID` per line). Use `Set rep` to flag class-rep students.
4. Create session: `Use my GPS` or paste coordinates (verify via OSM link), radius (default 50 m), Present window (default 5 min), session length (default 5 min per spec §16 — extendable).
5. System mints a fresh signed QR (`token` valid until close). Display it — each class gets a new one; old QRs die on expiry/close.
6. Monitor Live attendance: filters (All/Present/Late/Out of Range/Rep), manual walk-in add, override any record to Present/Late/Out of Range/Absent/Excused, remove wrong entries. Extend `+5 min` or Close early; closing materialises Absent for roster no-shows.
7. Reports: per-course percentages across closed sessions with Excused % shown separately. Export CSV, or Print → Save as PDF.

## Status rules
- In radius + within Present window → Present. In radius + after → Late.
- Distance > radius → Out of Range (still stored for review).
- Roster member with no record at close → Absent (auto-inserted).
- Lecturer override → Excused (or force Present/Absent), audit-logged.

## Setup
```sh
cp .env.example .env.local   # set PUBLIC_CONVEX_URL (dev file already present)
pnpm install
npx convex dev         # push schema (functions in src/convex/), seed admin
pnpm dev
```

## Deploy to Cloudflare Workers

The app ships as a Worker (`@sveltejs/adapter-cloudflare` → `.svelte-kit/cloudflare/_worker.js`,
see `wrangler.jsonc`). No Worker secrets are needed — the admin password lives in Convex and
the Convex URLs reach the Worker as `vars`.

> **Dev mode (current):** the committed `vars` in `wrangler.jsonc` point at the dev Convex
> deployment (`dev:affable-fly-983`), so Git-connected builds work with no dashboard setup.
> When going live, replace them with the prod URLs (dashboard Variables or `--var` flags).

1. Ship the backend to production Convex first (needs your explicit go-ahead — it creates/updates
   the prod deployment, separate from `dev:affable-fly-983`):
   ```sh
   npx convex deploy   # prints the PROD url, e.g. https://<slug>.convex.cloud
   ```
   Then unlock `/lecturer` on the prod site once and change the admin password from `admin123`.
2. `wrangler login`, then from `Svelte/lams`:
   ```sh
   pnpm run deploy:dry   # validate bundle + config without uploading
   pnpm run build
   pnpm exec wrangler deploy \
     --var PUBLIC_CONVEX_URL:https://<prod-slug>.convex.cloud \
     --var PUBLIC_CONVEX_SITE_URL:https://<prod-slug>.convex.site
   ```
   Use `--var`: wrangler reads neither `.env.local` nor the shell environment for deploys
   (both verified via `--dry-run`) and the committed config intentionally carries no URLs — so a
   CLI deploy without `--var` ships a Worker with no Convex URL (the app shows "not configured").
   If dashboard Variables already exist, add `--keep-vars` so the CLI deploy doesn't wipe them.
   Always use the **prod** Convex URLs — never the dev (`affable-fly-983`) ones.
3. Git-connected deploys (dashboard → Workers & Pages → Connect Git): root directory
   `Svelte/lams`, build command `pnpm run build`, environment variable
   `PUBLIC_CONVEX_URL=https://<prod-slug>.convex.cloud`. `preview_urls` gives every PR its own
   preview Worker; `wrangler tail` streams production logs (query strings redacted so QR
   tokens never persist in logs).

Theme: shadcn-svelte `luma` + LAMS navy `#1e3a5f` / green `#1b7a3d` tokens in `src/routes/layout.css`.
Decisions log: `DECISIONS.md`.
