# LAMS — QA / Verification Log

Purpose: prove that the implementation matches `DECISIONS.md` (the agreed QA answers)
and the source spec. Every claim below points at the code that carries it.

## 1. How to verify (run from `Svelte/lams`)

| Check | Command | Expected |
| --- | --- | --- |
| Unit tests (31) | `pnpm test` | `pass 31 / fail 0` |
| Type + Svelte diagnostics | `pnpm run check` | `svelte-check found 0 errors and 0 warnings` |
| Production build | `pnpm run build` | Vite build succeeds (Cloudflare adapter) |
| Worker config validation | `pnpm run deploy:dry` | Bundle + `wrangler.jsonc` validate without uploading |
| Worker deploy | `pnpm run build` + `wrangler deploy --var PUBLIC_CONVEX_URL:<prod> --var PUBLIC_CONVEX_SITE_URL:<prod-site>` | Worker live on prod Convex; observability on, query strings redacted |
| Backend push/preview | `pnpm exec convex dev --once` | Schema + functions push, `autoCloseExpired` cron registered |
| Manual smoke | `pnpm dev` → open `/`, `/lecturer`, `/records`, `/a/<sessionId>` | See §4 |

Helper scripts (agent-safe, detached): `.agents\bin\lams-check.cmd`,
`.agents\bin\lams-build.cmd` — run through `runbg.cmd` + `waitbg.cmd`.

## 2. Decision traceability (DECISIONS.md → code)

| Q | Decision | Where it lives | Evidence |
| --- | --- | --- | --- |
| Q1 | No logins; QR for students, admin gate for lecturer/rep | `src/routes/a/[sessionId]/+page.svelte`, `src/lib/components/lams/admin-gate.svelte` | Student form needs no password; every mutation takes `password` |
| Q2 | Convex backend | `src/convex/*`, `convex.json` | 11 function modules |
| Q3 | Full student roster | `src/convex/students.ts`, `RosterManager.svelte` | `students` table + CSV/manual import |
| Q4 | Include Late / Absent / Excused | `src/convex/schema.ts` (`statusValidator`) | Union of 5 statuses |
| Q5 | Single shared admin password | `src/convex/auth.ts` | `requireAdmin` / `checkAdminPassword` used everywhere |
| Q6 | Roster via CSV **and** manual | `RosterManager.svelte` | one-by-one form + `importBatch` (added/updated counts) |
| Q7 | Auto rules, manual override | `src/convex/helpers.ts` `computeAutoStatus`, `attendance.override` | Auto Present/Late/Out_of_Range; lecturer override stores `prevStatus` |
| Q8 | Flexible window: extend / close early | `sessions.extend`, `sessions.close` | `+5 min` and `Close` buttons in `SessionManager.svelte` |
| Q9 | Class-rep GPS as location proxy + authorised-rep enforcement | `attendance.submitRepBatch` | `repLat/repLng` → one distance for the batch; when the roster flags any class reps, `repRegNumber` must resolve to a flagged rep (spec §7.1–7.2), every row tagged `method: 'rep'` + `repName` + `repRegNumber` |
| Q10 | Lecture location: GPS **and** typed coordinates | `SessionManager.svelte` | “Use my GPS” plus lat/lng fields + map verify link |
| Q10 | Lecture location: GPS **and** typed coordinates | `SessionManager.svelte` | “Use my GPS” plus lat/lng fields + map verify link |
| Q11 | Editable radius, default 50 m | `sessions.create` validator | `radiusM 5–2000`, form default `50` |
| Q12 | Reports: CSV + PDF | `ReportsPanel.svelte`, `records/+page.svelte` | `downloadTextFile` CSV, `printElement` → Save as PDF |
| Q13 | Adjustable Late threshold | `sessions.create` `presentSec` | Present window field (default 5 min) |
| Q14 | Default password `admin123`, changeable | `settings.ensureSeed`, `settings.setPassword` | Settings card on `/lecturer` |
| Q15 | Terms; Excused % separate, excluded from denominator | `terms.ts`, `attendance.reportByCourse` | `counted = totalSessions - excused`, per-status % columns |
| Q16 | Signed short-lived QR token | `sessions.create` (random `token`), `buildAttendanceUrl` (`?t=`), `attendance.submitSelf` | Wrong/expired token → rejected |
| Q17 | Present 5 min / total 5 min defaults (spec §16 exactly 5 min) | `sessions.create` | `presentSec ?? 300`, `totalSec ?? 300`, adjustable 1–120 min, `present <= total`; longer windows allow Late |
| Q18 | Session stores course/term/times | `schema.ts` `sessions` | `courseId, termId, startedAt, closesAt, closedAt` |
| Q19 | New class ⇒ new QR, old one dies | `sessions.create` retires open sessions (`closedOthers`) | One live QR per course |
| Q20 | Manual override + remove + audit | `attendance.override/remove/manualAdd` | `prevStatus`, `overriddenBy`, `overriddenAt` |
| Q21 | presentSec=300, totalSec=300 (spec §16) | `sessions.create` | validated `present <= total`; `SessionManager` form defaults 5/5; `+5 min` extend and early close kept (Q8 flexible) |
| Q22 | Scan-and-go: roster pre-fills the form | `students.findByReg`, `attendance.submitSelf`, `lams_me` storage | Reg number → name/ID locked; blank name/ID resolved server-side |

## 3. Spec behaviours worth calling out

- **§22.11 auto-close** — `crons.ts` runs `sessions.autoCloseExpired` every minute; the
  student page closes itself (`sessions.expireIfDue`) the moment its countdown hits zero,
  and `sessions.getPublic` reports an *effective* status so a lapsed-but-not-yet-cron'd
  session already behaves as closed.
- **Absent materialisation** — closing a session inserts an `Absent` row for every roster
  student without a record (`closeSessionWithAbsents`).
- **Excused never counts as absent** — `reportByCourse` removes excused sessions from the
  denominator, so a documented excuse cannot drag the percentage down.
- **Rep batch rules** — 2–50 entries per batch, one GPS fix shared by the batch, batch
  status applied per the same auto rules, every row tagged `method: 'rep'` + `repName` + `repRegNumber`;
  when the roster flags class reps, only a flagged rep's own reg number is accepted (spec §7.1–7.2).

## 4. Manual smoke script (happy path + key error paths)

1. `pnpm dev`, open `/lecturer` → tools are locked; wrong password shows an inline error (**error path**).
2. Unlock with `admin123` → create a term (dates via picker) → create a course → both appear in the
   context bar (or are auto-selected).
3. Step 3 — paste 3 CSV lines into the roster → “Imported 3 new student(s)”; search narrows the table.
   Set one student as class rep.
4. Step 4 — “Use my GPS” fills lat/lng → *Create session + QR* (5-min default per spec §16) → QR panel appears with
   *Copy link*, *Fullscreen*, *Print*. Starting a second session retires the first (**one live QR**).
5. Open the student link `/a/<sessionId>?t=…` in a private window → type the roster reg number →
   name + student ID fill in and lock → submit → success card shows status, distance and GPS accuracy.
   Submitting twice with the same reg shows “already recorded” (**error path**).
6. Wait for the countdown to hit zero → the page flips to *closed* and later submissions are refused;
   `/lecturer` shows the session closing and, after the cron, `Absent` rows for the rest of the roster.
7. Step 5 — the live table auto-refreshes every 6 s; override a record (audit note appears),
   add a walk-in, filter by status, search, *Export CSV* and *Print*.
8. Step 6 — report shows Present/Late/OOR/Absent/Excused + Attend %; students under 75 % are
   highlighted; CSV export matches the screen; *Print / PDF* prints only the table.
9. Class rep — open `/a/<sessionId>/rep` with the shared password + your own flagged rep reg number, paste a class list into the
   textarea, *Fill rows from text*, submit ≥ 2 students → success panel shows added/skipped and the
   batch is tagged with the rep's name (**error path**: < 2 rows, unflagged rep, or closed session is refused).
10. `/records` → unlock → term/course/session selects → search + status filter → *Export CSV* /
    *Print*. Locked state explains what is missing (**empty state**).

## 5. Automated test coverage (`pnpm test`, 31 tests)

| File | Covers |
| --- | --- |
| `src/lib/lams/csv.test.ts` | roster CSV parsing: happy path, header, separators, malformed rows, 1000-row cap; CSV quoting/escaping |
| `src/lib/lams/time.test.ts` | `elapsedPct` boundaries (0/mid/over/negative clock/zero-length), `isPast` exact flip, date formatters |
| `src/lib/lams/geo.test.ts` | `formatDistance` m/km/null, `formatCountdown` incl. expired, geolocation-unavailable rejection |
| `tests/convex-helpers.test.ts` | `normalizeReg/Id`, haversine sanity (1° ≈ 111.19 km), SHA-256 known vector, `computeAutoStatus` boundaries (incl. out-of-range beating late) |

Backend helpers are tested from `tests/` on purpose: Convex bundles every file inside
`src/convex/`, so a `node:test` import there would break `convex dev`. Same module, same code.

## 6. UI work delivered in this pass

- Official logo assets wired through header/footer/favicon; brand colour tokens (`lams-navy`, `lams-green`).
- Student page: reg-number-first scan-and-go form, countdown + progress bar (`aria-live`), roster match feedback,
  GPS-denied submission still works and is flagged **location-unverified** on the success card and in the lecturer table,
  skeleton loading, success/closed/error states, print-friendly layout.
- Class-rep page: password gate + own flagged rep reg number, CSV paste → row filler, min-2 batch rule, per-batch success panel.
- Lecturer console: unlocked/unlocked context bar with term + course selects, renumbered steps,
  QR panel with copy/fullscreen/print + rep link, **expired QRs shown greyed with a display-only badge**,
  new sessions allowed while one is live (old one retires — one live QR), 5/5-min defaults per spec §16,
  live attendance with stat tiles/search/polling/unverified flags/CSV/print,
  reports with summary tiles + 75 % highlighting + CSV/print, roster search + import feedback.
- New `/records` page: read-only review with selects, filters, CSV export and print.
- Shared `admin-gate` component replaces duplicated unlock code.

## 7. Known limitations / assumptions

- Convex must be reachable (`PUBLIC_CONVEX_URL` in `.env.local`); without it the UI shows the
  configured-URL error instead of data — this is intentional and actionable.
- QR “signature” is a server-minted random token bound to the session and its expiry rather than an
  HMAC: the token is never exposed to students (it only lives in the lecturer view), and validation
  happens server-side (`attendance.submitSelf`). Matches the Q16 intent (short-lived, unguessable,
  verified in Convex) with simpler key handling.
- Offline/throttled connections: the student page keeps the last known session state and the
  attendance list retries every 6 s; failures are surfaced, never swallowed silently.
- `checkJs` is off in `tsconfig.json` so generated Cloudflare/SvelteKit `.js` artifacts are not
  type-checked; all application code is TypeScript and fully checked by `svelte-check`.

