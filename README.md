# LAMS — Lecture Attendance Monitoring System

Attend • Track • Succeed.

A QR code sits on a screen at the front of the hall and refreshes every 30
seconds. Students scan it with their own phones; their name, the time and how far
their phone was from the screen are recorded automatically. Built for phones
first: attendance for a lecture hall takes a couple of minutes and nobody types a
roster by hand.

> `assessment/` and `DECISIONS.md` are the original spec and the historical
> decision log from the first build. The system has since been rebuilt three times —
> around per-person accounts, then the station-scan flow, then device-bound scans —
> so those documents are archived history, not the source of truth. This README and
> `QA.md` describe the current system. See `SECURITY.md` for the threat model and,
> importantly, for what the location check cannot do.

## How the system fits together

Data model (see `src/convex/schema.ts`):

```
Semester ──< Class >── ClassMember ──< Student (people, role: student | rep)
Subject (catalogue) ──< Offering (subject × class × semester) ──< Enrolment
Class ──< ClassRep (rep rights over a whole class)
Offering ──< Meeting (weekly slot or one-off makeup) ──< Session (live window) ──< Attendance record
```

- **Semesters** scope offerings; a class is assigned to one.
- **A student can belong to several classes** — the repeating-student case,
  where they sit in a junior class for one subject while their cohort moves on.
  Membership is many-to-many (`classMembers`).
- **Subjects** are a reusable catalogue (code, title, hours, lecturer of record).
- **Offerings** put a subject in front of a class in a semester.
- **Class reps** can take attendance for anything their class takes — the right
  is granted per class, not per subject, and several reps can share a class.
- **Attendance follows enrolments, not classes.** A repeating student enrolled
  in another class's subject is scanned, reported and auto-absented exactly
  like everyone else in that offering.
- **Attendance statuses**: `Present`, `Late`, `Out_of_Range`, `Absent`, `Excused`.
  Excused lectures leave the percentage denominator.
- **Sessions** carry both a lecture radius and a station radius, because the code
  students scan is usually on a screen at the front of the hall rather than at the
  lecture's centre. The station radius defaults to the lecture position.

## Roles and routes

| Role | Signs in with | Routes |
| --- | --- | --- |
| Student | Registration number + PIN (device-bound) | `/home` `/timetable` `/courses` `/attendance`, and `/a/<session>` when they scan the station |
| Class rep | Same as a student | adds `/scan` — run the station and take attendance for their class |
| Lecturer | Username + password (seeded `admin`/`admin` — change it immediately) | `/manage` (console) `/scan` `/records` `/settings` |

## Taking attendance

1. A rep or lecturer opens a lecture on `/scan`. That mints a **per-lecture station
   secret** and pins the station's position and radius.
2. The same page shows the QR for the front of the hall — full screen, with the
   rotating code in large type beside it and a countdown. It re-derives the code
   locally every 30 seconds, so it keeps working with no signal.
3. Students scan with their own phone cameras. The link opens the app, which asks
   for location and submits the code, the device id and the position fix in one
   request. **A scan is refused unless it came from the one device that student's
   account is bound to**, so a copied token cannot be used to mark them present
   from another phone.
4. Records appear on the rep's list as they arrive. Anything that did not add up is
   surfaced separately rather than buried.
5. **No phone, or a record that needs changing**: the rep adds the student by hand
   (roster autocomplete + required reason) or overrides a record, while the lecture
   is open. Lecturer-only `override` still works after it closes. Both are
   audit-logged.
6. Closing the lecture marks everyone with no record **Absent**.

A student who scans while signed out has the scan held for them: signing in returns
them straight to the lecture and it records automatically.

## Setup flow (lecturer console, `/manage`)

The tabs follow the real setup sequence:

1. **Classes & semesters** — create the semester first, then classes with a
   year of study and that semester. Classes can be renamed, re-assigned or
   removed (removal is refused while subjects are still offered to it).
2. **Students** — pick a class, add students one by one or paste a roster
   (`Full name, Reg number, Student ID` per line). Each student is `invited`
   until they activate with reg number + student ID and choose a PIN. Per
   student: make/remove **class rep**, edit details, tick **every class they
   belong to** (for repeats), reset PIN, move account to a new phone,
   suspend/unblock.
3. **Subjects** — build the catalogue (code + title + hours, lecturer of
   record editable), then **offer** subjects to the selected class. For each
   offering: manage the **roster** — withdraw or assign students, including
   students from other classes (repeats), — open/close self-enrolment, or
   remove it.
4. **Timetable** — weekly slots and one-off makeups per offering, with clash
   detection.
5. **Lectures** — start a live attendance window (GPS or pasted coordinates,
   radius, on-time and late windows), see what is open, and jump to scanning.

## Attendance registration (`/scan`)

Both lecturers and class reps can start a lecture from the scanning screen; a
rep only sees their own classes' subjects.

1. Open the lecture (or start one), then scan each student's rotating code —
   the code rolls every 30 seconds and is derived from a per-student secret.
2. Status is automatic: in range and on time → **Present**; after the on-time
   window → **Late**; after the late window → **Absent** (with a plain
   explanation). Weak or contradictory GPS flags the record for review instead
   of silently deciding.
3. Students without a working phone: add by hand — type a name or reg number
   (suggestions come from the class roster) and pick a status.
4. While the window is open you can **+5/+10 min** the closing time, undo your
   own recent scans, and close early (which writes an **Absent** row for every
   enrolled student with no record).
5. After being scanned, a student's phone reports its own location once — that
   upgrades the record to `confirmed` or raises a flag for the lecturer.

## Review (`/records`, lecturer)

Per subject: totals and percentages for every student, CSV export, and
"Save as PDF" via the browser print dialog. Open a student's **History** for
their per-subject totals and individual records — flagged and disputed records
show their reasons and the student's own words, and can be overridden
(audit-logged) or deleted. Bulk "mark excused/present/absent" applies to
everyone below 75%.

## Status rules

- In radius + within the on-time window → **Present**; after it → **Late**.
- A coarse or contradictory location → record still created, **flagged** for
  review (`scan_only` / `weak` / `confirmed` verification).
- No record when the lecture closes → **Absent** (auto-inserted by the close
  mutation and a Convex cron).
- Excused is set by the lecturer and excluded from percentages.

## Development

```sh
cp .env.example .env.local   # set PUBLIC_CONVEX_URL
pnpm install
npx convex dev               # push schema + functions (src/convex/), seed admin/admin
pnpm dev                     # http://localhost:5173
pnpm test                    # node --test unit tests (src/lib/lams/*.test.ts, tests/)
pnpm run check               # wrangler types + svelte-check
```

Theme: shadcn-svelte + LAMS navy `#1e3a5f` / green `#1b7a3d` tokens in
`src/routes/layout.css`. UI primitives live in `src/lib/components/ui`
(shadcn-svelte on bits-ui); app panels in `src/lib/components/lams`.

## Deploy to Cloudflare Workers

The app ships as a Worker (`@sveltejs/adapter-cloudflare` →
`.svelte-kit/cloudflare/_worker.js`, see `wrangler.jsonc`). No Worker secrets
are needed — the Convex URLs reach the Worker as `vars`.

1. Ship the backend first:
   ```sh
   npx convex dev      # dev deployment (dev:affable-fly-983)
   npx convex deploy   # production — prints the PROD url
   ```
2. From `Svelte/lams`:
   ```sh
   pnpm run deploy:dry   # validate bundle + config without uploading
   pnpm exec wrangler deploy \
     --var PUBLIC_CONVEX_URL:https://<prod-slug>.convex.cloud \
     --var PUBLIC_CONVEX_SITE_URL:https://<prod-slug>.convex.site
   ```
   Use `--var`: wrangler reads neither `.env.local` nor the shell environment
   for deploys, and the committed config intentionally carries no URLs — a CLI
   deploy without `--var` ships a Worker with no Convex URL. If dashboard
   Variables already exist, add `--keep-vars`. Always use the **prod** Convex
   URLs, never the dev ones.
3. Git-connected deploys (dashboard → Workers & Pages → Connect Git): root
   directory `Svelte/lams`, build command `pnpm run build`, environment
   variable `PUBLIC_CONVEX_URL=https://<prod-slug>.convex.cloud`.

First run: sign in at `/signin` → "I am a lecturer" with the seeded
`admin`/`admin`, then change the password in Settings.
