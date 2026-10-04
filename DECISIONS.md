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

## Round 6 — Station scan, and distance-based presence (2026-10-04)

### Q23: Should the QR stay on the student's phone, or move to a fixed screen?
**A:** Fixed screen at the front of the hall. Students scan it; they are not scanned.

Locked — the direction of the scan is the security decision, not the QR itself:
- Session mints a per-lecture `stationSecret`; the display derives a 6-digit code
  from it every 30s and encodes `https://<host>/a/<sessionId>?c=<code>`.
- `station.verifyStationCode` accepts ±1 slot for display-vs-server clock skew
  (90s worst-case replay, judged acceptable because the distance check covers it).
- This reverses Q22's flow. Superseded: the rep no longer scans.

### Q24: Is the 30-second rotation enough to stop sharing?
**A:** No. It stops *delayed* use, not immediate forwarding.

Locked — the two controls are complementary and each covers the other's gap:
- The station is public, so anyone near it can photograph the code and send it on.
  The photograph is therefore **not** the control.
- What actually stops remote sharing is that the redeeming phone reports its own
  position: a phone in a bedroom is `Out_of_Range` and flagged.
- This is only possible because the scanning device is the student's own, so the
  distance is a first-party measurement. The old flow could only use the rep's phone
  as a proxy, with the student's phone as a later confirmation step.

### Q25: What if the student's phone reports no location, or a poor one?
**A:** Record it and flag it. Never silently count it as a clean Present.

Locked — `verification` is the audit surface:
- Fix coarser than 2× the station radius → distance withheld from the status
  calculation entirely (`positionUsable` false), time tier decides, `weak` + flag.
- No fix at all → `unconfirmed` + flag.
- Rationale: a coarse fix cannot distinguish inside from outside, so it must not
  produce a confident verdict either way; but a phone with broken GPS is not a
  cheater, so the record is not destroyed.

### Q26: Students without a phone?
**A:** Hand-add by a rep or lecturer, with attribution; rep-level override added.

Locked:
- `attendance.addManually` (roster autocomplete + optional `reason`) → `method: 'rep'`,
  `recordedBy`, `overrideReason`, `verification: 'scan_only'` — the distance there is
  the *rep's* phone and is never evidence about the student.
- `attendance.overrideDuringSession` lets a class rep change any record in their
  class while the lecture is open (Q20's lecturer-only `override` still handles
  settled lectures). Audit-logged: `prevStatus`, `overriddenBy`, `overriddenAt`.
- Sessions now carry `stationLat/Lng/RadiusM` separately from the lecture position.

### Q27: Should a scan be tied to one phone?
**A:** Yes, checked at scan time as well as at sign-in.

Locked — sign-in already refuses a second device, but that runs once. Afterwards a
token is a bearer credential sitting in `localStorage`, so it can be copied, backed
up, or synced to another phone, and an absentee holding it would land the record on
the student's own attendance. `submitStationScan` therefore also takes `deviceId`:
- presented device == the session's device, else `mismatch`
- session's device == `people.boundDeviceId`, else `moved`
- `attendance.scannerDeviceId` records it (the column already existed, unused)
- `helpers.judgeScanDevice` holds the pure rule; both branches have distinct student-
  facing messages because the fix differs (re-sign-in vs. go find your new phone)

Honest limit, recorded in `SECURITY.md`: bound phone **plus** PIN is still the
account. Borrowing both defeats this; only the distance check remains.

### Q28: What if the student scans while signed out?
**A:** Stash the scan, sign in, land straight back on the lecture, submit
automatically.

Locked — the scan is held in `sessionStorage` (not `localStorage`: a station code is
worthless in about a minute). `pendingScanTarget()` is read by `/signin`, which
returns the student to `/a/<sessionId>` instead of `/home`. Entries expire after 15
minutes and are keyed to one `sessionId`, so a stash cannot be spent on a different
lecture. An expired or moved token mid-submit routes back through the same path.

Net effect for requirement "a scan completes the registration without doing anything
else": signed in, one scan and one location grant is the whole flow.

### Q29: Audit gaps found and fixed (2026-10-04)
**A:** Six, all now closed.

- **Station code brute force.** Six digits, server-verified, previously unthrottled.
  Now `ratelimit.noteFailure` keyed `station:<personId>` with deliberately generous
  `STATION_LIMITS` (40 / 5 min) — a student whose camera will not focus must not be
  punished like a PIN-guesser. Success clears the count.
- **Rep override with no reason.** The largest remaining integrity gap: a rep could
  rewrite the register with nothing recorded. `reason` is now **required** on both
  `addManually` and `overrideDuringSession`, enforced server-side. `/scan` offers a
  datalist of the reasons that actually occur.
- **Expired-code dead end.** A stale code failed with a "Try again" button that
  retried the *same* dead code. The landing page now detects it and asks for a fresh
  camera scan instead.
- **`stationLat/Lng` comment overpromised** a pinnable station location that
  `startSession` never accepted. Comment corrected to say they are seeded from the
  lecture position.
- **Stale copy** on `/scan` and `start-session-form` still said "start scanning";
  now describes the station and labels the field "Station radius".
- **`clearDevice` was already sound** (it deletes the person's sessions) — the new
  scan-time check makes it belt-and-braces rather than the only barrier.
