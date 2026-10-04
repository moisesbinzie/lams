# LAMS — Attendance Security Model

How attendance is recorded, what stops someone marking themselves present when
they are not in the room, and — just as importantly — **what it cannot stop.**

## The flow

1. A lecturer or class rep **adds the student** — name, registration number, student ID. Nobody can add themselves, so there is no public sign-up.
2. The record sits as **invited**. It cannot sign in, and cannot produce a code.
3. The student signs in with **registration number + student ID** and chooses their own PIN. Staff never see or choose it.
4. That phone is **bound** to the account. Any other device is refused.
5. The phone shows a code derived from a **per-student secret**, refreshed **every 30 seconds**.
6. The class rep or lecturer scans it and confirms. One scan per student per lecture.
7. A missed scan becomes **Absent** when the lecture closes.
8. The record stores: student, who recorded it, their device, time, location, and the outcome. The student can dispute it.

Lecturers never go through this path. They sign in at `/signin` → **I am a lecturer** with a username and password (seeded `admin` / `admin`), against the separate `staff` table.

Code: `src/convex/people.ts`, `src/convex/staff.ts`, `src/convex/attendance.ts`, `src/convex/scancode.ts`, `src/lib/lams/totp.ts`.

## Timing rules

Three tiers, both thresholds adjustable per lecture by the lecturer:

| Arrival | Status |
| --- | --- |
| Within `onTimeSec` (default 5 min) | Present |
| Between `onTimeSec` and `lateUntilSec` (default 10 min) | Late |
| After `lateUntilSec` | Absent |
| Beyond the permitted radius, at any time | Out of Range |

Distance overrides the time tier deliberately: a student outside the radius is
flagged however early they arrived, because that is the condition a lecturer
needs to investigate rather than accept. A late scan is still **recorded**, not
rejected, so the lecturer can see that the student actually turned up at 11
minutes and override it if the circumstances warrant.

## What each control actually buys

| Control | Where | Stops |
| --- | --- | --- |
| Staff-only registration | `people.createPerson` | Anyone outside the class signing themselves in. This is the answer to "what if a visitor registers as a student". |
| Lecturers are a separate identity kind | `staff` vs `people`, `staffSessions` vs `authSessions` | A student who guesses a registration number cannot reach a lecturer account. `resolveActor` checks both tables but never reinterprets one token as the other. |
| Two-identity activation | `people.activate` | Claiming an account from a guessable registration number. Both the reg number **and** student ID are required. |
| Lecturer-set PIN reset | `people.resetPin` | PINs are never known to staff, so a rep cannot sign in as a student. |
| Device binding | `people.login` | Signing in as someone else **on a different phone**. Lending a phone still works — see the limits. |
| 30-second rotating code | `scancode.verifyScanCode` | Screenshots and photos. A picture is stale within one slide of the phone. |
| Secret-derived code | `scancode.codeForSlot` | Forging a code from a registration number alone — impossible without the per-student secret. |
| Code bound to the offering | `attendance.recordScan` | A student's code being used to mark attendance for a different subject or class. |
| One scan per student per lecture | `attendance.recordScan` | Replaying a code or scanning the same student twice. |
| Time-window check | `attendance.recordScan` | Using a code from an earlier lecture. |
| Scanner attribution | `attendance.recordedBy`, `recordedById` | Untraceable marking. Every scan names the person who made it. |
| Student reports their own location after being scanned | `attendance.confirmMyLocation` | A rep marking an absentee who is not in the room — the two location readings disagree and the record is flagged. |
| Coarse GPS is never treated as a verdict | `proximity.judgeProximity` | A ±400 m fix silently marking someone Present or Out of Range on a 50 m radius. |
| Implausible scan pace is flagged | `attendance.scanAnomalyNote` | A rep marking a room they are not standing in. |
| Credential probing is throttled | `ratelimit.noteFailure` | Walking the space of registration numbers to find weak PINs. |
| Student-visible history | `attendance.myAttendance` | Silent fraud. The student sees who recorded each entry. |
| Disputes | `attendance.dispute` | Errors going unchallenged. Flagged entries surface to the lecturer. |

## Verification, layer by layer

| Layer | Question it answers | Status |
| --- | --- | --- |
| Rotating code | Was this student's own code used? | Built |
| Device binding | Was it their own phone? | Built |
| Rep's location | Was the scanner in the hall? | Built |
| **Student's own location** | **Was the student in the hall?** | **Built** |
| GPS precision | Is the reading good enough to judge? | Built |
| Pace anomaly | Was this a real roll call? | Built |
| Credential probing | Is someone guessing PINs? | Built |
| Ledger review | Did anything look wrong? | Built — human decision |

The gap that mattered most has been closed. When a student is scanned, their own
phone notices within four seconds and reports **its** location. Both readings are
compared against the lecture hall and stored. A student who was recorded present
but whose phone was 900 m away is **flagged** for the lecturer rather than
silently corrected — that judgement belongs to a person, not a rule.

This works because a student must have the code page open to show their code, so
confirmation costs no extra step in practice.

## What it does NOT stop — read this part

**No software can tell the difference between "Amina is holding her phone" and
"Chifuto is holding Amina's phone."** If an absentee is physically handed a
classmate's phone *and* the classmate's phone is genuinely in the lecture hall,
the location check passes. Two independent signals can both be faked with one
handed-over phone.

Two limits remain that I could not close in software:

- **Mock locations cannot be detected from a web page.** Android exposes a
  developer "mock location" setting, but the browser Geolocation API gives a page
  no way to tell a real fix from a simulated one. Native attestation (Play
  Integrity, or a Bluetooth/UWB beacon in the hall) would be needed — both are
  well beyond this project's scope.
- **A multi-storey building breaks a flat radius.** Two floors up can be inside
  50 m horizontally and nowhere near the room. There is no altitude input in the
  Geolocation API, so this cannot be solved with the data available.

Further honest limits:

- **Device binding raises the cost of impersonation; it does not remove it.** The
  bound device holds a live signed-in session. Moving to a new phone rotates the
  QR secret, so the old handset's codes fail immediately rather than lingering
  for the session lifetime.
- **A class rep holds real power.** They can scan any enrolled student. The audit
  trail, the student's own visibility, and the flagged list are the checks on
  that, not a technical bar.
- **One shared lecturer password.** Every lecturer account can change any
  record, so whoever holds the password has full authority. Per-lecturer
  usernames exist in Settings if you need to tell who was working, but they all
  share the same password.
- **No email or SMS.** PIN resets, disputes and flags are only seen by opening
  the app.

### Practical consequences for how you deploy this

- The flow is meaningfully stronger than a design where the QR *is* the
  attendance ticket and can be forwarded to anyone anywhere. Sharing is now
  self-defeating: the absentee loses their own attendance.
- It is **not** a substitute for a lecturer who looks at the room. Review the
  scan list — a rep scanning forty students in twenty seconds is visible.
- Keep rep passwords out of reach of students. A rep who can read a student's PIN
  can act as them.

## What is stored

- Student name, registration number, student ID, class.
- Lecturer username, display name, and a salted, iterated SHA-256 hash of the shared password.
- Account status, role, and the device a student is bound to.
- A per-student QR secret — server-side only.
- Per attendance record: method (`scan`, `rep`, `manual`, `absent`), recorder
  name, role and id, timestamps, **both** the rep's and the student's coordinates
  and distances, verification level (`scan_only` / `confirmed` / `weak`), any
  flag and its reason, prior status on overrides, and any student dispute.
- Failed sign-in and activation attempt counts, for rate limiting.