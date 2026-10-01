# LAMS — Questions & Decisions Log

Source: Lecture Attendance Monitoring System PDF (23 sections) + logo (Present / Absent / Late / Excused).
Project: `svelte/lams` — fresh SvelteKit + Tailwind + adapter-cloudflare, Convex backend, shadcn-svelte (luma).

## Round 1 — Core architecture

### Q1: How should Lecturers, Class Reps, and Admins log in? Who creates accounts?
**A:** No login for anybody, use QR codes. Lecturers and class reps should have an admin password gate.

### Q2: What backend for sessions + attendance records?
**A:** Convex.

### Q3: How should Courses/Classes work?
**A:** Full student roster.

### Q4: Logo shows Present / Absent / Late / Excused, PDF only Present / Out of Range. Which for V1?
**A:** Include Late/Absent/Excused.

## Round 2 — Details

### Q5: How should the admin password gate work?
Options: single shared password / per-course PIN / lecturer+CR passwords.
**A:** Single shared password.

### Q6: How should the full student roster be added?
**A:** Both CSV + manual.

### Q7: How should Late / Absent / Excused be decided?
**A:** Auto rules, manual override.

Interpretation locked:
- Auto: in-range + on-time = Present, in-range + after present-window = Late, out-of-range = Out of Range, roster no-show after close = Absent.
- Manual: lecturer (password-gated) can mark any record Excused / Present / Absent.

### Q8: Strict 5 min or flexible?
**A:** Flexible 5 min (default 5, allow extend / close early).

Later superseded to default 10 (see Q10).

### Q9: For class-rep registrations, how should location work?
**A:** Use CR location (CR phone GPS as proxy).

Authorisation (spec §7.1–7.2, added 2026-10-01): single shared password is kept (Q5),
but when the roster flags any class reps the batch must carry the rep's own roster reg
number and it must resolve to a flagged rep — otherwise the submission is rejected.

### Q10: How should lecturer set lecture location?
**A:** Both GPS + map picker.

### Q11: Radius fixed 50m or editable?
**A:** Editable, default 50m.

### Q12: Reports / percentages export?
**A:** CSV + PDF export.

## Round 3 — Hardening

### Q13: Late threshold?
**A:** Late threshold defaults to 10 minutes, should be adjustable.

### Q14: Default password?
**A:** Default password should be `admin123`, lecturer can set or edit.

### Q15: Terms + Excused %?
**A:** Term dates. Excuses should show separate percentage.

Interpretation:
- `terms { name, startDate, endDate }`, courses linked to term.
- Report columns: Present% / Late% / Absent% / Excused% (separate) / Out-of-Range count.
- Excused excluded from Absent denominator.

### Q16: QR security?
**A:** Need signed short 10-minutes token.

Interpretation:
- QR payload `/a/<sessionId>?t=<token>`, `token = HMAC(sessionId|exp, secret)`, exp = start + total window (default 10 min).
- Verify server-side in Convex, reject expired/invalid. New session = new token.

## Round 4 — Final clarifications

### Q17: Present / Late defaults?
**A:** Present / Late should all default to 10.

Locked: `presentSec=600`, `totalSec=600`, both adjustable, `present <= total`.

### Q18: Does the system set class start time and date per course?
**A:** Yes (confirmed in flow).

Locked: session stores `courseId, termId, date, startedAt, closedAt` auto-captured, grouped per course.

### Q19: Does QR expire and create a new one on a new class?
**A:** Yes (confirmed).

Locked: each session = new unique signed QR, expires on close/expiry, never reused.

### Q20: Manual override to mark Present / Absent?
**A:** Yes (confirmed).

Locked: lecturer password-gated override to Present / Late / Absent / Excused, plus remove + manual add, audit-logged.

## Additional requirements (build turn)

- Provision to set a student as Class Rep.
- Registration should include student ID (in addition to full name + registration number).
- Use shadcn-svelte UI style (already configured, `components.json` luma).
- Convex already scaffolded (`src/convex/`, `convex.json` points there).
- Explain system flow usage for students, class reps, lecturers (see README / landing page).

## Key principle (from PDF §23)
Student does as little as possible (scan + full name + reg number + student ID); system does the rest automatically (date, time, location, distance, session validation, status).

## Round 5 — Timing + scan-and-go (2026-10-01)

### Q21: Present / Late defaults?
**A:** Present 5 minutes, session length 5 minutes (spec §16 exactly 5 min).

Locked (revised 2026-10-01 for PDF compliance): `presentSec=300`, `totalSec=300`, both
adjustable 1–120 min, `present <= total`. A longer total window re-enables Late;
extend / close-early stay available (Q8 flexible).

### Q22: Student registration vs attendance typing?
**A:** Registration holds name + reg number + student ID so students only scan and go.

Locked:
- Roster is the registration (lecturer CSV/manual, fields name + reg + ID).
- Attendance form is reg-number-first: typing a roster reg auto-fills name + ID (public `students.findByReg`, minimal fields) and locks the fields.
- Server accepts blank name/ID when the reg resolves from the roster (`attendance.submitSelf` fills from roster, rejects unknowns with "not on roster" errors).
- Phone remembers last submission in `localStorage` (`lams_me`) and prefills next session; "Not you?" clears it.
