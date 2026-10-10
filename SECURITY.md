# LAMS — Attendance Security Model

How attendance is recorded, what stops someone marking themselves present when
they are not in the room, and — just as importantly — **what it cannot stop.**

## The flow

1. A lecturer or class rep **adds the student** — name, registration number, student ID. Nobody can add themselves, so there is no public sign-up.
2. The record sits as **invited**. It cannot sign in, and cannot produce a code.
3. The student signs in with **registration number + student ID** and chooses their own PIN. Staff never see or choose it.
4. That phone is **bound** to the account. Any other device is refused.
5. The lecturer or rep opens the lecture, which mints a **per-lecture station secret** and puts a QR on the screen at the front of the hall.
6. The screen shows a code derived from that secret, refreshed **every 60 seconds**, encoded as a URL.
7. Students **scan it with their own phones**. The same phone reports its position at that moment, and the server refuses the scan unless it came from the one device the account is bound to. One scan per student per lecture.
8. A missed scan becomes **Absent** when the lecture closes.
9. The record stores: student, method, time, the student's own coordinates and distance, verification level, and any flag. The student can dispute it, and a lecturer or rep can mark the dispute reviewed.

Students without a working phone are added by a rep or lecturer by hand, tagged with who entered them and why.

Staff never go through the student path. They sign in with a username and password against the separate `staff` table, through their own door: **I am an admin** (seeded `admin` / `admin` — change it immediately) or **I am a lecturer** (username plus the temporary password the admin issued, which must be changed in Settings before anything else). Admins see everything; lecturers only see offerings assigned to them, plus unassigned offerings in classes they already teach (sick-leave cover).

Code: `src/convex/people.ts`, `src/convex/staff.ts`, `src/convex/attendance.ts`, `src/convex/station.ts`, `src/lib/lams/station.ts`.

## Why a scan is tied to one phone

Sign-in already refuses a second device, but that check happens **once, at login**.
Afterwards a token is a bearer credential: it sits in `localStorage`, so it can be
copied to another phone by hand, restored from a backup, or carried across by a
browser profile sync. Without a second check, a student could hand their token to an
absentee, who scans the station with it and lands a record on the student's own
attendance — which is exactly the "registering attendance for others" this is meant
to prevent.

`submitStationScan` therefore closes the loop on every scan, and `helpers.judgeScanDevice`
is the pure rule:

| Check | Refuses when |
| --- | --- |
| presented device == session's device | the token was moved onto another handset |
| session's device == account's bound device | the account was moved to a new phone while an old session was still live |

This also makes `people.clearDevice` airtight: the old phone's sessions are deleted,
but even if one survived, it would no longer match the account's new binding.

### What device binding does NOT close

**Possession of the bound phone plus the PIN is still the account.** If an absentee
borrows a classmate's handset *and* knows their PIN, they can sign in on it — it is
genuinely that account's device — and scan. Device binding cannot distinguish that
from the owner doing it. What still stops it is the distance check: the borrowed
phone reports itself far from the station and the record is flagged. That is a weaker
guarantee than it looks, because the same student who can borrow the phone can also
spoof the location.

So honestly: device binding removes the *casual and mechanical* sharing routes
(token copied over, backup restored, profile synced, old session outliving a
rebind). It does not remove a determined student who has the handset and the PIN.

## Why a stationary code, and why the distance check carries the weight

The direction of the scan is the security decision here, and it was deliberately
inverted from the previous design.

**The rotating code alone does not stop sharing.** The station is a public screen.
Anyone standing near it can photograph the code and send it to an absentee. The
photograph is therefore *not* the control — the distance check is. A phone in a
bedroom redeeming a photographed code reports itself as far outside the radius, so
the record is created but marked **Out of Range** and flagged for the lecturer.

That is the whole mechanism, and it is worth being blunt about its two halves:

| Signal | Stops | Gap it leaves |
| --- | --- | --- |
| Station code, per-lecture secret, 60-second roll | Forwarding the link to someone who will use it minutes or days later | A code photographed at the hall is good for up to 3 minutes, so it can be sent to someone *nearby* — or forwarded instantly to someone far away |
| Student's own reported distance | Redeeming that code from outside the hall | Spoofable; see the limits below |

They cover each other. Neither is much use alone.

The previous design — student shows a personal code, rep scans it — had a worse
property: the position check used the **rep's** phone as a proxy for the student's,
because the student's own phone was only consulted afterwards as a confirmation
step. In the new design the device reporting position is the one that scanned, so
the distance is a first-party measurement taken at the moment of the scan.

## Timing rules

Three tiers, both thresholds adjustable per lecture by the lecturer:

| Arrival | Status |
| --- | --- |
| Within `onTimeSec` (default 5 min) | Present |
| Between `onTimeSec` and `lateUntilSec` (default 10 min) | Late |
| After `lateUntilSec` | Absent |
| Beyond the station radius, at any time | Out of Range |

Distance overrides the time tier deliberately: a student outside the radius is
flagged however early they arrived, because that is the condition a lecturer
needs to investigate rather than accept. A late scan is still **recorded**, not
rejected, so the lecturer can see that the student actually turned up at 11
minutes and override it if the circumstances warrant.

### Precision is a separate question from distance

A phone reporting a fix coarser than twice the station radius cannot distinguish
inside from outside — at ±150 m for a 50 m radius, a seat inside and a corridor
outside are the same reading. In that case `submitStationScan` **withholds the
distance from the status calculation entirely**, lets the time tier decide, and
sets `verification: 'weak'` plus a flag. Letting a coarse fix produce a confident
verdict in either direction would either fail honest students on bad signal or
wave through absent ones.

If the student denies location altogether the record is still created, tagged
`verification: 'unconfirmed'` and flagged. It is deliberately **not** silently
counted as a clean Present, because presence is what the whole scheme is
measuring — but it is also not thrown away, because a phone with broken GPS is not
a cheater.

## What each control actually buys

| Control | Where | Stops |
| --- | --- | --- |
| Staff-only registration | `people.createPerson` | Anyone outside the class signing themselves in. This is the answer to "what if a visitor registers as a student". |
| Lecturers are a separate identity kind | `staff` vs `people`, `staffSessions` vs `authSessions` | A student who guesses a registration number cannot reach a lecturer account. `resolveActor` checks both tables but never reinterprets one token as the other. |
| Two-identity activation | `people.activate` | Claiming an account from a guessable registration number. Both the reg number **and** student ID are required. |
| Lecturer-set PIN reset | `people.resetPin` | PINs are never known to staff, so a rep cannot sign in as a student. |
| Device binding | `people.login` | Signing in as someone else **on a different phone**. Lending a phone still works — see the limits. |
| **Scan-time device binding** | `auth.requirePersonOnDevice` → `helpers.judgeScanDevice` | **A token carried to another phone** and used to mark the owner present. `scannerDeviceId` is stored on the record. |
| Station code guesses are throttled | `ratelimit.noteFailure` with `STATION_LIMITS` | Brute-forcing the six-digit code. Generous limits (40 / 5 min) so a student fumbling with a camera is not punished like a credential-guesser. |
| Station code rolls every 60 s | `station.verifyStationCode` | Forwarding the link for use later. A photographed screen goes stale in up to 3 minutes. |
| Station secret is per-lecture | `station.stationCodeForSlot` + `attendance.startSession` | A code from this morning's lecture, or a code read off a screen in a different hall. |
| Clock-skew window of one slot | `station.STATION_WINDOW` | Refusing everyone because the display's clock drifted — the skew that matters is display-vs-server, not student-vs-server. |
| Code bound to the offering | `attendance.submitStationScan` | A station code being used to mark attendance for a different subject. |
| One scan per student per lecture | `attendance.submitStationScan` | Replaying a code or scanning the same student twice. |
| Time-window check | `attendance.submitStationScan` | Scanning a closed lecture. |
| Enrolment check | `attendance.submitStationScan` | A student marking attendance for a subject they are not taking. |
| **Student's own reported distance** | `attendance.submitStationScan` → `proximity.judgeProximity` | **Redeeming a shared or photographed code from outside the hall.** |
| Coarse GPS never produces a verdict | `attendance.submitStationScan` (`positionUsable`) | A ±400 m fix silently marking someone Present or Out of Range on a 50 m radius. |
| Hand-added records are attributed | `attendance.addManually` → `recordedBy`, `overrideReason` | An invisible "this one has no phone" exception. Every hand-added row names the person who added it. |
| Rep overrides are audit-logged | `attendance.overrideDuringSession` | A rep quietly rewriting the register during a lecture. `prevStatus`, `overriddenBy`, `overriddenAt` and a **required** `reason` are all kept. |
| Hand-adds require a reason | `attendance.addManually` | An unexplained "this one has no phone" exception. The reason is mandatory server-side, not just in the form. |
| Credential probing is throttled | `ratelimit.noteFailure` | Walking the space of registration numbers to find weak PINs. |
| Student-visible history | `attendance.myAttendance` | Silent fraud. The student sees who recorded each entry. |
| Disputes | `attendance.dispute` | Errors going unchallenged. Flagged entries surface to the lecturer. |

## Verification, layer by layer

| Layer | Question it answers | Status |
| --- | --- | --- |
| Per-lecture station secret | Was this lecture's screen scanned? | Built |
| 60-second roll | Was it scanned just now, not earlier? | Built |
| Device binding | Was it their own phone? | Built |
| **Scan-time device binding** | **Was this scan made on the phone the account is bound to?** | **Built** |
| **Student's own reported distance** | **Was the student in the hall?** | **Built** |
| GPS precision | Is the reading good enough to judge? | Built |
| Code-guess throttling | Is someone brute-forcing the station code? | Built |
| Credential probing | Is someone guessing PINs? | Built |
| Attribution + override trail | Who recorded or changed this, and why? | Built |
| Ledger review | Did anything look wrong? | Built — human decision |

Every one of these is a first-party signal taken at scan time. There is no
second-guessing pass and no polling loop: the student scans once, and the same
request carries the code, the session and the position fix.

## What it does NOT stop — read this part

**No browser-delivered location is a security boundary.** A student with a
mock-location app, or anyone using a desktop browser with developer tools open, can
report themselves as sitting inside the hall from anywhere on earth. Android
exposes a developer "mock location" setting, but the Geolocation API gives a page
no way to distinguish a real fix from a simulated one. This scheme raises the cost
of cheating and produces a legible audit trail; it does not make cheating
impossible. Native attestation (Play Integrity, or a Bluetooth/UWB beacon in the
hall) would be needed for that, and both are well beyond this project's scope.

Treat this as a deterrent plus an audit trail for human review — never as proof of
physical presence.

Further honest limits:

- **The bound phone plus the PIN is still the account.** See "What device binding
  does NOT close" above. Anyone holding both can act as the student.
- **`deviceId` is a random string in `localStorage`, not a hardware attestation.**
  Worse, the token (`lams_token`) lives in the same storage next to it. Copying
  **both** values to another phone passes every device check, because the server
  cannot tell a copied pair from the original. The binding stops casual and
  mechanical routes (backup restore, profile sync, old session outliving a
  rebind) — it does not stop deliberate copying by someone with both values.
- **Geolocation needs a secure context.** Browsers only expose it over HTTPS (or
  `localhost`). Served over plain HTTP, every record comes through `unconfirmed`
  and flagged, and no distance check runs at all.

- **A multi-storey building breaks a flat radius.** Two floors up can be inside
  50 m horizontally and nowhere near the room. There is no altitude input in the
  Geolocation API, so this cannot be solved with the data available. In a
  multi-storey block, set the station radius as small as the building allows and
  expect to review Out of Range records by hand.
- **The station code is visible to the whole room.** Anyone can photograph it and
  replay it for up to 3 minutes. The distance check is what makes that useless;
  if you disable the distance check, sharing becomes trivial again.
- **Denying location is allowed.** A student who blocks location permission is
  recorded and flagged rather than refused, so a genuine GPS failure is not
  punished — but it does mean a flagged record is not automatically an honest one.
  A lecturer who sees many unconfirmed records from one device should look.
- **Device binding raises the cost of impersonation; it does not remove it.**
  Handing your phone to someone else still works.
- **A class rep holds real power.** They can mark any enrolled student present by
  hand, and override any record during the lecture. The audit trail, the reason
  field, the student's own visibility, and the lecturer's review afterwards are the
  checks on that — not a technical bar.
- **Lecturers hold real power over their own subjects.** A lecturer can add,
  override and remove records for assigned offerings. The per-record stamps
  (`recordedBy`, `recordedByStaffId`, `overriddenBy`, `prevStatus`), the
  student's own visibility, and the admin's audit log are the checks on
  that — not a technical bar.
- **The student ID is a weak second factor.** Rosters and the students table
  show it to lecturers and reps, so anyone with roster access learns both
  halves needed to claim an account (reg number + student ID). Treat it as an
  onboarding check, not a secret.
- **No email or SMS.** PIN resets, disputes and flags are only seen by opening
  the app.

### Practical consequences for how you deploy this

- The station QR needs a screen. A cheap tablet, a laptop on the desk, or the rep's
  own phone propped at the front all work. Put something behind it so students
  cannot pick it up.
- Full screen on the display is worth the effort: the code in large type next to
  the QR means a student whose camera will not focus can read it out.
- Set the station radius deliberately. 50 m is a default, not a recommendation —
  a large hall with a QR at the door and a lecture at the back needs more, and a
  lecture theatre with a QR in the middle needs less.
- It is **not** a substitute for a lecturer who looks at the room. Review the
  record list, especially anything flagged.
- Keep rep passwords out of reach of students. A rep who can read a student's PIN
  can act as them.

## Staff passwords and recovery

- Lecturer and admin passwords are generated server-side (10 unambiguous
  characters) and shown **once**. The account carries `mustChangePassword`
  until the owner picks their own in Settings; first sign-in lands there
  directly. Manually chosen passwords (`staff.createStaff`) get the same flag.
- Passwords are salted, iterated SHA-256 (`sha2i`, 2048 rounds). Weaker than
  argon2/scrypt, which Convex cannot call synchronously — it stops a leaked
  database yielding plaintext, nothing more.
- Keep **at least two active admins** (the console nags you to). If every
  admin password is lost, the break-glass is a shell command with deployment
  credentials — never app code (`migrations:resetStaffPassword`). It signs
  the account out everywhere, reactivates it, and forces a change at next
  sign-in.

## Audit log

Privileged actions outside per-record stamps are journaled in `auditLog`
(admin-visible in the console, newest first): staff creation, password
resets, activation switches, renames, lecturer assignments, rep grants and
revokes, student suspends, PIN resets, device moves, and bulk status changes.
Per-record attendance changes keep their own stamps (`recordedBy`,
`recordedByStaffId`, `overriddenBy`, `prevStatus`, dispute resolution).

## History is never deleted

Anything with lecture records behind it cannot be removed: offerings with
sessions, subjects/classes/semesters with sessions underneath. Deactivating a
lecturer releases their offerings back to unassigned (reassign from the
console) but keeps every record. Sessions stamp who opened them
(`startedByStaffId`), so reassigning a subject or renaming an account never
rewrites history; displayed names are snapshots, ids are links.

## Known query limits

List and report queries cap their scans (`take(200)`–`take(5000)` depending
on the table) to stay inside Convex execution limits. Past those sizes,
lists and percentages silently cover only the most recent rows. The caps to
raise-or-paginate first when the school grows: `subjectReport` sessions
(300), `lecturerStats` sessions (2000), `listPeople` (1000), `classMembers`
per class (2000).

## What is stored

- Student name, registration number, student ID, class.
- Staff username, display name, role, a salted iterated password hash, and whether a self-chosen password is still owed.
- Account status, role, and the device a student is bound to.
- Sessions stamp who opened them (`startedByStaffId`, `startedByName`).
- The `auditLog` trail described above.
- A per-lecture station secret — server-side only, returned only to a rep or
  lecturer who may already take that class's attendance.
- Per attendance record: method (`station`, `scan`, `rep`, `manual`, `absent`),
  the scanning device id, time, the student's own coordinates, accuracy and distance
  from the station, verification level (`confirmed` / `weak` / `unconfirmed` /
  `scan_only`), any flag and its reason, the required reason for any hand-added or
  overridden record, prior status on overrides, and any student dispute.
- Failed sign-in and activation attempt counts, for rate limiting.

## Legacy path

The earlier design — student shows a personal rotating code, the rep scans it — has
been removed. `attendance.recordScan`, `attendance.myScanCode`,
`attendance.confirmMyLocation` and `attendance.myLatestScan` are gone, along with
`src/convex/scancode.ts`, `src/lib/lams/totp.ts` and the `qr-scanner.svelte` camera
component. Nothing derived a code from a student's own secret any more.

The data those functions wrote is deliberately left in place: `attendance` rows with
`method: 'scan'`, the optional `people.qrSecret` field, and `verification:
'scan_only'`. Existing records must keep validating, and `method` still appears in
reports and CSV exports, so both literals stay in the schema. Dropping them is a
schema migration for whoever owns the deployment, not a code clean-up — clear the
live `method: 'scan'` rows first, then narrow `schema.ts` and `types.ts`.

The `/code` route and the nav entry that pointed at it were removed earlier, so
students were never led into the old flow.