# LAMS — QA / Verification Log

Purpose: prove the implementation matches the documented flows (see `README.md`),
and to record honestly what it does **not** do. Every claim points at the code.

> **Architecture note (2026-10-02, revised twice on 2026-10-04).** Rebuilt around a
> subject/class/meeting model with per-person PIN sign-in. Class-rep rights were
> re-scoped from **per subject** to **per class** (2026-10-04): a rep can take
> attendance for anything their class takes.
>
> **The scan direction was then inverted (2026-10-04).** Attendance is no longer
> "rep scans each student's rotating code". A QR now sits on a fixed screen at the
> front of the hall, refreshing every 30 seconds, and students scan it with their
> own phones; the record is judged on **how far the student's own phone was from
> the station**. This matches §4 of the source PDF in `assessment/` more closely
> than the previous flow did, but keeps the per-student accounts of §21.
>
> The rotation alone does not stop sharing — the screen is public and its code can
> be photographed. The distance check is what makes sharing useless, and the
> student's own phone reporting it is what makes the check first-party. Scans are
> additionally **tied to the one device each account is bound to**, so a copied
> token cannot be used to mark someone present from another phone. See
> `SECURITY.md` for the threat model and its limits.

## 1. How to verify (run from `Svelte/lams`)

| Check | Command | Expected |
| --- | --- | --- |
| Unit tests (98) | `pnpm test` | `pass 98 / fail 0` |
| Type + Svelte diagnostics | `pnpm run check` | `svelte-check found 0 errors and 0 warnings` |
| Production build | `pnpm run build` | Vite build succeeds (Cloudflare adapter) |
| Backend push | `pnpm exec convex dev --once` | Schema + functions push, cron registered |
| Manual smoke | `pnpm dev` → `/`, `/signin`, `/home`, `/timetable`, `/courses`, `/attendance`, `/scan`, `/a/<sessionId>`, `/manage`, `/records` | See §4 |

## 2. Data model

| Table | Holds | Why it exists |
| --- | --- | --- |
| `people` | one human: student or rep | One identity record per person, holding reg number, student ID, PIN hash, role and device binding. Class membership moved to `classMembers` (2026-10-04). |
| `staff` | lecturer accounts | Username + password. Separate from `people` so a lecturer cannot be reached by guessing a student reg number. |
| `semesters` | academic year + semester number + dates | The reporting period. Offerings require one; created in the console (was previously backend-only). |
| `classes` | a cohort, e.g. BSc CS Year 2 | Assigned to a semester; subjects are offered to it. |
| `classMembers` | person + class | **Many-to-many.** A student can sit in several classes (repeating a subject from a junior class). Replaces the old single `people.classId`. |
| `subjects` | the course catalogue | Saved once, reusable across classes and semesters. Editable (title, hours, lecturer of record). |
| `offerings` | subject + class + semester | The unit students enrol in and lecturers report on. |
| `enrolments` | person + subject + offering | The many-to-many join. Records whether the student chose it or was assigned. |
| `classReps` | person + class | Rep rights scoped per **class** (re-scoped from per subject in 2026-10-04); many reps per class. |
| `meetings` | weekly slot or one-off make-up | What makes a timetable possible. |
| `sessions` | a live attendance window | The 5–10 minute window during which scans are accepted; startable by lecturers **and** class reps. Holds the **station** position and radius separately from the lecture position, plus the per-lecture `stationSecret` behind the rotating code. |
| `attendance` | one student's result in one session | Carries method, time, **the student's own** coordinates, accuracy and distance from the station, verification level, flags and audit trail. |
| `authAttempts` | failed sign-in / activation counts | Rate limiting so registration numbers cannot be walked to find weak PINs. |

## 3. Decision traceability

| Decision | Where it lives |
| --- | --- |
| No public registration — staff add students | `people.createPerson`, `people.importPeople`; no public register mutation exists |
| Login by registration number | `people.login` |
| Lecturers sign in with username + password, seeded `admin` / `admin` | `staff.login`, `staff.ensureSeed`, `staffSessions` table |
| The two identities cannot be confused | separate `staffSessions` vs `authSessions`; `resolveActor` checks both but never reinterprets one as the other |
| Change the lecturer password | `staff.changePassword` (rejects the default), `staff.createStaff` for more lecturers |
| PIN set by the student on first login, never seen by staff | `people.activate`, `people.resetPin` |
| Activation needs reg number **and** student ID | `people.activate` |
| Per-student PIN, resettable individually | `people.resetPin` clears the hash and returns the person to `invited` |
| Students may edit own details, not IDs | `people.updateMyName`, `people.updateMyDetails` (no ID args); `people.updatePerson` is lecturer-only |
| **A student can belong to several classes** | `classMembers` table; `people.createPerson`/`importPeople` add membership, `people.updatePerson` takes the full `classIds` list |
| **Self-enrolment follows membership, not one class** | `enrolments.listOpenForStudent` unions the student's classes; `enrolSelf` accepts any offering of a class they belong to |
| **Attendance follows enrolments, not classes** | `attendance.submitStationScan`/`addManually`/`closeWithAbsents` check only the offering's active enrolments — a repeat student is treated like everyone else |
| Students self-select from open subjects | `enrolments.listOpenForStudent`, `enrolments.enrolSelf` |
| Staff can assign or withdraw any class member | `enrolments.assignForPerson`, roster dialog on `/manage` → Subjects |
| Rep rights are per **class** | `reps.setRep`, `auth.canRecordFor` (classId), `classReps` table |
| Reps and lecturers both start sessions | `attendance.startSession` (`requireRecorder` + `canRecordFor`), `attendance.listRecordableOfferings` |
| Reps run the station; reps override during, lecturers after | `attendance.stationFeed`/`submitStationScan` (student-side) vs `attendance.overrideDuringSession` (rep, session open, **reason required**) vs `attendance.override` (lecturer-only, audit-logged) |
| Record review with drill-down | `reports.personReport`, `reports.personRecords` on `/records` → History |
| Weekly repeating timetable | `timetable.createWeekly`, `timetable.myTimetable` |
| Lecturer can create a make-up lecture | `timetable.createMakeup` |
| Make-up registration still happens | Make-ups attach to an offering, so the same enrolled roster is marked |
| Subjects saved and reused | `academics.createSubject`, `academics.createOffering`; `updateSubject` / `removeSubject` / `updateClass` / `removeClass` for corrections |
| Semesters managed in the console | `academics.createSemester`, `academics.removeSemester` (refused while in use) |
| Records span the whole school period | `attendance` indexed by `personId`; reports filter by semester or date range |
| Present ≤ 5 min, Late ≤ 10 min, then Absent | `helpers.computeAutoStatus` |
| Timings adjustable; window extendable live | `attendance.startSession` accepts `onTimeSec`/`lateUntilSec`; `attendance.extendSession` (+5/+10 min on `/scan`) |
| **Student's own phone reports its distance at scan time** | `attendance.submitStationScan` — the scanning device *is* the student's, so there is no proxy and no later confirmation pass |
| **A scan only counts from the bound device** | `auth.requirePersonOnDevice` → `helpers.judgeScanDevice`; refuses both a token moved to another phone and a session outliving a device rebind |
| **Station code guessing is throttled** | `ratelimit.noteFailure` with `STATION_LIMITS` (40 / 5 min, cleared on success) |
| **A scan survives a sign-in detour** | `station.pendingScanTarget` read by `/signin`; 15-min TTL, keyed to one `sessionId` |
| **A GPS fix coarser than the radius never produces a verdict** | `proximity.judgeProximity` returns `inside: null`; `submitStationScan`'s `positionUsable` withholds the distance from `computeAutoStatus` entirely |
| **Unverifiable records are flagged, never silently corrected** | `submitStationScan` → `verification: 'weak' \| 'unconfirmed'` + `flagged` + `flagReason` |
| **Implausible scan pace is flagged** | `attendance.scanAnomalyNote` |
| **Credential probing is rate limited** | `ratelimit.ts`, wired into `people.login`, `people.activate`, `staff.login` |
| **A network failure never signs the user out** | `lib/lams/session-state.ts` (`decideSession`): only a definite null answer clears the token; failures show a retry instead |
| **One shared session source of truth for the navbar** | `lib/lams/session.svelte.ts`; sign-in/out and invalid-session boot-outs all update it |
| Moving a device invalidates the old phone's codes | `people.clearDevice` rotates `qrSecret` |

## 4. Manual smoke script

1. `/signin` → **I am a lecturer** → sign in with `admin` / `admin` (created automatically on first run) → change it in **Settings**.
2. Console → **Classes & semesters** → create a semester → create a class assigned to it.
3. **Students** → pick the class → add one student (or paste a roster). That student opens `/signin` → **Set up your account** → reg number + student ID + PIN → signs in.
4. **Subjects** → add a subject to the catalogue → offer it to the class → open **Roster** and confirm the student is on it (or enrol them there) → open enrolment.
5. Student opens `/courses` → joins the subject. `/timetable` shows it once a meeting time is set.
6. Console → **Timetable** → add a weekly slot (and a make-up lecture).
7. Console → **Lectures** → "Use my location" → set on-time 5 / late-until 10 → **Start lecture**.
8. Open `/scan` → scan the student's code → name and time appear. Scan again → refused as a duplicate. Try **+5 min** and **Close lecture** (absent rows appear for no-shows).
9. **Students** → **Make rep** for that student → they open `/scan` → **Start a lecture now** lists their class's subjects; they can undo their own scan mid-lecture but not change a status.
10. `/records` → subject report with percentages; **History** on a student shows per-subject totals and individual records; override one and confirm the audit stamp; download list / Save as PDF.
11. Reload any page while signed in → the navbar holds a skeleton while the session is checked and never flashes "Sign in" for a signed-in user.

## 5. Automated test coverage (`pnpm test`, 98 tests)

| File | Covers |
| --- | --- |
| `tests/convex-helpers.test.ts` | **`judgeScanDevice`**: the bound phone passes; an unbound account passes; **a token on another phone is refused (`mismatch`)**; **a session outliving a device rebind is refused (`moved`)**; a dead session short-circuits; an empty device id is refused; **no prefix, trailing-space or case-fold near-miss is accepted** |
| `src/lib/lams/station.test.ts` | **client/server agreement** on the station code (500 slots); determinism; no repeats in 200 slots; **no slot-to-slot counter structure** (what stops a code being guessed from a neighbour); six-digit width; **wrong-secret rejection** (another lecture's code); **stale-photo rejection after the roll**; **bounded replay window** (a photographed code dies, but not instantly); ±1 slot clock skew; malformed-code rejection; countdown boundaries; **pending-scan helpers degrade safely with no storage (SSR)** and refuse a stash from another lecture |
| `src/lib/lams/totp.test.ts` | **client/server agreement** on the legacy rotating code; wire format; 30s rollover; wrong-secret rejection; stale screenshot rejection; ±1 slot clock drift; foreign-payload rejection (incl. session URLs) |
| `tests/convex-proximity.test.ts` | **accuracy-aware proximity**: a fix coarser than the radius returns `inside: null` instead of guessing; inside/outside boundaries; widened radius; missing fix; contradiction wording incl. the modest-overshoot tolerance |
| `tests/convex-helpers.test.ts` | `computeAutoStatus` across all three time tiers, **adjusted and tightened thresholds**, out-of-range precedence (including after the late window), missing-GPS handling; `normalizeReg`/`Id`; haversine; SHA-256 |
| `src/lib/lams/session-state.test.ts` | **session policy**: no-token → anonymous; resolved session → authed; null answer → sign out; **a failed query must not clear the token** (the network-blip sign-out regression) |
| `src/lib/lams/csv.test.ts` | roster CSV parsing, header, separators, malformed rows, 1000-row cap, quoting |
| `src/lib/lams/time.test.ts` | `elapsedPct` boundaries, negative clock, date formatters |
| `src/lib/lams/geo.test.ts` | distance/countdown formatting, geolocation-unavailable rejection |

Backend helpers are tested from `tests/` on purpose: Convex bundles every file
inside `src/convex/`, so a `node:test` import there would break `convex dev`.

## 6. Known limitations

- **Bound phone + PIN is still the account.** A student who borrows a classmate's
  handset *and* knows their PIN can sign in on it and scan. Device binding cannot
  tell that from the owner; only the distance check remains, and it is spoofable.
  See `SECURITY.md`.
- **`deviceId` is not hardware attestation** — it is a random string in
  `localStorage`. It defeats copying a token to another phone, not anyone already
  signed in on the bound device.
- **Browser location is spoofable, and this is the load-bearing gap.** A student
  with a mock-location app, or anyone using a desktop browser with developer tools
  open, can report themselves inside the hall from anywhere. The Geolocation API
  gives a page no way to tell a real fix from a simulated one. Treat the scheme as
  a deterrent plus an audit trail for human review — **never** as proof of
  presence. See `SECURITY.md`.
- **The station code is public, so it can be photographed.** It is good for up to
  90 seconds. That is why the distance check is the control rather than the code —
  do not disable it.
- **Denying location is permitted.** A record with no fix is created and flagged
  (`unconfirmed`) rather than refused, because a phone with broken GPS is not a
  cheater. A student can therefore opt out of the distance check, at the cost of a
  flag on their record. Watch for a device producing many of these.
- **Phone-sharing is still not detectable.** If an absentee is handed a
  classmate's phone *and* that phone is genuinely in the hall, everything agrees.
- **A flat radius cannot express a multi-storey building.** There is no altitude
  in the Geolocation API, so someone two floors up can be inside 50 m
  horizontally and nowhere near the room.
- **Geolocation requires HTTPS.** Served over plain HTTP the browser withholds
  location entirely, so every record arrives `unconfirmed` and flagged and no
  distance check runs.
- **The default lecturer password is `admin`.** Change it in Settings before real
  use; the server refuses to keep it once a new one is set.
- **One shared lecturer password.** Anyone holding it can change any record. Add
  per-lecturer usernames in Settings if several people need access — they exist,
  but they share that password.
- **No email or SMS.** PIN resets, disputes and flags are only seen by opening
  the app.
- **`jsqr` has no maintained typings**; it ships its own and is used directly.
- **Timetable clashes are warned about, not blocked** — a clash check runs when
  the time changes, but the slot can still be saved if intended.
- **Rep rights re-scoped per class (2026-10-04).** Deployments that used the old
  per-subject `subjectReps` table must re-grant reps in **Students → Make rep**;
  the old table is no longer read.
- **Class membership re-scoped to many-to-many (2026-10-04).** The single
  `people.classId` column was removed; the idempotent backfill
  (`people:backfillClassMembers`) ran on the dev deployment (`moved: 0`, no
  legacy assignments existed). Any **production** deployment must run it once
  after pushing the schema that still contains the legacy column, before
  pushing the removal.
