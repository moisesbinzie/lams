# LAMS — QA / Verification Log

Purpose: prove the implementation matches the documented flows (see `README.md`),
and to record honestly what it does **not** do. Every claim points at the code.

> **Architecture note (2026-10-02, revised 2026-10-04).** Rebuilt around a
> subject/class/meeting model with per-person PIN sign-in and an inverted
> attendance flow (the rep or lecturer scans each student's rotating code).
> This deliberately departs from the source PDF in `assessment/`, which assumes
> no student accounts (§21) and a lecture-displayed QR (§4). Class-rep rights
> were re-scoped from **per subject** to **per class** (2026-10-04): a rep can
> take attendance for anything their class takes. See `SECURITY.md` for the
> threat model and its limits.

## 1. How to verify (run from `Svelte/lams`)

| Check | Command | Expected |
| --- | --- | --- |
| Unit tests (73) | `pnpm test` | `pass 73 / fail 0` |
| Type + Svelte diagnostics | `pnpm run check` | `svelte-check found 0 errors and 0 warnings` |
| Production build | `pnpm run build` | Vite build succeeds (Cloudflare adapter) |
| Backend push | `pnpm exec convex dev --once` | Schema + functions push, cron registered |
| Manual smoke | `pnpm dev` → `/`, `/signin`, `/home`, `/code`, `/timetable`, `/courses`, `/attendance`, `/scan`, `/manage`, `/records` | See §4 |

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
| `sessions` | a live attendance window | The 5–10 minute window during which scans are accepted; startable by lecturers **and** class reps. |
| `attendance` | one student's result in one session | Carries method, recorder, device, time, **both** the rep's and the student's location, verification level, flags and audit trail. |
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
| **Attendance follows enrolments, not classes** | `attendance.recordScan`/`addManually`/`closeWithAbsents` check only the offering's active enrolments — a repeat student is treated like everyone else |
| Students self-select from open subjects | `enrolments.listOpenForStudent`, `enrolments.enrolSelf` |
| Staff can assign or withdraw any class member | `enrolments.assignForPerson`, roster dialog on `/manage` → Subjects |
| Rep rights are per **class** | `reps.setRep`, `auth.canRecordFor` (classId), `classReps` table |
| Reps and lecturers both start sessions | `attendance.startSession` (`requireRecorder` + `canRecordFor`), `attendance.listRecordableOfferings` |
| Reps scan; only lecturers override | `attendance.recordScan` / `attendance.undoOwnScan` vs `attendance.override` (audit-logged) |
| Record review with drill-down | `reports.personReport`, `reports.personRecords` on `/records` → History |
| Weekly repeating timetable | `timetable.createWeekly`, `timetable.myTimetable` |
| Lecturer can create a make-up lecture | `timetable.createMakeup` |
| Make-up registration still happens | Make-ups attach to an offering, so the same enrolled roster is marked |
| Subjects saved and reused | `academics.createSubject`, `academics.createOffering`; `updateSubject` / `removeSubject` / `updateClass` / `removeClass` for corrections |
| Semesters managed in the console | `academics.createSemester`, `academics.removeSemester` (refused while in use) |
| Records span the whole school period | `attendance` indexed by `personId`; reports filter by semester or date range |
| Present ≤ 5 min, Late ≤ 10 min, then Absent | `helpers.computeAutoStatus` |
| Timings adjustable; window extendable live | `attendance.startSession` accepts `onTimeSec`/`lateUntilSec`; `attendance.extendSession` (+5/+10 min on `/scan`) |
| **Student's own phone reports location after being scanned** | `attendance.confirmMyLocation`, polled from `/code` |
| **A GPS fix coarser than the radius never produces a verdict** | `proximity.judgeProximity` returns `inside: null` |
| **Contradictory locations are flagged, never auto-corrected** | `attendance.confirmMyLocation` → `flagged` + `flagReason` |
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

## 5. Automated test coverage (`pnpm test`, 73 tests)

| File | Covers |
| --- | --- |
| `src/lib/lams/totp.test.ts` | **client/server agreement** on the rotating code; wire format; 30s rollover; **wrong-secret rejection (cannot forge from a reg number)**; stale screenshot rejection; ±1 slot clock drift; foreign-payload rejection (incl. session URLs) |
| `tests/convex-proximity.test.ts` | **accuracy-aware proximity**: a fix coarser than the radius returns `inside: null` instead of guessing; inside/outside boundaries; widened radius; missing fix; contradiction wording incl. the modest-overshoot tolerance |
| `tests/convex-helpers.test.ts` | `computeAutoStatus` across all three time tiers, **adjusted and tightened thresholds**, out-of-range precedence (including after the late window), missing-GPS handling; `normalizeReg`/`Id`; haversine; SHA-256 |
| `src/lib/lams/session-state.test.ts` | **session policy**: no-token → anonymous; resolved session → authed; null answer → sign out; **a failed query must not clear the token** (the network-blip sign-out regression) |
| `src/lib/lams/csv.test.ts` | roster CSV parsing, header, separators, malformed rows, 1000-row cap, quoting |
| `src/lib/lams/time.test.ts` | `elapsedPct` boundaries, negative clock, date formatters |
| `src/lib/lams/geo.test.ts` | distance/countdown formatting, geolocation-unavailable rejection |

Backend helpers are tested from `tests/` on purpose: Convex bundles every file
inside `src/convex/`, so a `node:test` import there would break `convex dev`.

## 6. Known limitations

- **Phone-sharing is still not detectable.** If an absentee is handed a
  classmate's phone *and* that phone is genuinely in the hall, both location
  signals agree and nothing catches it. See `SECURITY.md`.
- **Mock locations cannot be detected from a web page** — the browser Geolocation
  API exposes no way to distinguish a real fix from a simulated one.
- **A flat radius cannot express a multi-storey building.** There is no altitude
  in the Geolocation API, so someone two floors up can be inside 50 m
  horizontally and nowhere near the room.
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
