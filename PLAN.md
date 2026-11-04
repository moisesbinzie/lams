# LAMS UI Revision — Implementation Plan

Status: IN PROGRESS
Date: 2026-11-04

Eight UI/wording changes, investigated and mapped to exact files. Backend
(Convex functions, `meetings` table, timetable API) stays untouched unless a
default value itself changes (task 5).

---

## Task 1 — "Screen may move" fixed at 15 m, UI removed

The live UI is `src/lib/components/lams/start-session-form.svelte` (rendered on
`/scan`). `src/lib/components/lams/lecture-panel.svelte` is an unused twin with
the same section — it gets the same treatment so no stale copy remains. The
server already defaults to 15 (`DEFAULT_STATION_TOLERANCE_M` in
`src/convex/helpers.ts`), so once the client stops sending the field the
behavior is 15 m everywhere.

- [ ] `start-session-form.svelte`: delete `tolerance` state, the
      "Screen may move (m)" input block, and the paragraph that explains it;
      drop `stationToleranceM` from the `startSession` mutation payload.
- [ ] `lecture-panel.svelte`: same removals.

## Task 2 — How to use page: "start a lecture" → "generate QR code"

All in `src/routes/how-it-works/+page.svelte`:

- [ ] Lecturer section closing paragraph: "To start a lecture, select the
      course and press Start here…" → "To generate a QR code, select the course
      and press Generate QR code…".
- [ ] Lecturer Step 2 ("Start the lecture" / "press Start here") →
      "Generate the QR code" / "press Generate QR code".
- [ ] Lecturer FAQ ("How do I start a lecture quickly?" / "press Start here")
      → "generate a QR code" wording, for consistency on the same page.

Note: the actual button in the app still says "Start lecture"/"Start here" —
task as written only covers the How to use page. Flag to user at the end.

## Task 3 — Lectures heading

- [ ] `src/routes/lectures/+page.svelte`: remove the "Lectures" text from the
      `<h1>`; keep the "Lecturer account" / "Admin account" badge with its
      background. Nav item label "Lectures" is untouched (it is navigation,
      not the heading).

## Task 4 — "Create lecturer" → "Add lecturer"

- [ ] `src/lib/components/lams/admin-accounts-panel.svelte`: button label
      "Create lecturer" → "Add lecturer"; busy label "Creating…" → "Adding…".
- [ ] `src/routes/admin/+page.svelte` overview step 1: "Create lecturer
      accounts" → "Add lecturer accounts" (same action, keeps terminology
      uniform).

## Task 5 — Default radius 50 m → 15 m

- [ ] `src/convex/helpers.ts`: `DEFAULT_STATION_RADIUS_M` 50 → 15 (comment
      updated).
- [ ] `src/convex/attendance.ts`: `startSession` fallback
      `args.radiusM ?? 50` → 15; `startSessionQuick` `const radiusM = 50` → 15;
      update the doc comments that say "50 m".
- [ ] `start-session-form.svelte` + `lecture-panel.svelte`: `radius` state
      '50' → '15'; quick-start coarse-fix threshold (`> 50`) → 15; button
      labels "Start here — 50 m" / "Start anyway (50 m)" → 15 m; toast
      "50 m radius" → "15 m radius"; description texts likewise.
- [ ] `how-it-works/+page.svelte`: every "50 metre radius" → "15 metre
      radius" (Out of range status, lecturer step 2, FAQ, closing paragraph).

## Task 6 — Remove the below-75% UI (records page, admin/lecturer view)

All in `src/routes/records/+page.svelte`:

- [ ] Remove the "Below 75%" stat card and the `belowPct` derived value;
      stats grid `sm:grid-cols-4` → `sm:grid-cols-3`.
- [ ] Remove the "Bulk change for everyone below 75%" row, its three buttons,
      and the `excuse()` function.
- [ ] Remove the amber row tint applied at `attendPct < 75`.

## Task 7 — Replace "hall" with "classroom"/"room" wording

User-facing strings first, comments kept consistent. Files with occurrences:

- [ ] UI text: `qr-camera-scanner.svelte`, `start-session-form.svelte`,
      `lecture-panel.svelte`, `+layout.svelte` (meta description + footer),
      `+page.svelte` (landing), `a/[sessionId]/+page.svelte`,
      `attendance/+page.svelte`, `home/+page.svelte`, `scan/+page.svelte`,
      `scanner/+page.svelte`, `how-it-works/+page.svelte`.
- [ ] Server strings/comments: `convex/attendance.ts` (incl. the
      `farPinError` message students/lecturers see), `convex/helpers.ts`,
      `convex/proximity.ts`, `convex/ratelimit.ts`, `convex/schema.ts`,
      `convex/station.ts`, `convex/stationplace.ts`, `lib/lams/station.ts`,
      `signin/+page.svelte` comment ("Hall networks" → campus networks).
- [ ] Test wording: `lib/lams/geo.test.ts` ("within a hall").

## Task 8 — Remove the timetable UI across the app

Backend (`convex/timetable.ts`, `meetings` table, `api.timetable`) is kept —
data is preserved; only UI goes.

Delete:

- [ ] `src/routes/timetable/` (whole route).
- [ ] `src/lib/components/lams/timetable-panel.svelte`,
      `timetable-grid.svelte`, `timetable-slot-dialog.svelte`.
- [ ] `src/lib/lams/grid.ts` + `src/lib/lams/grid.test.ts` (only used by the
      timetable components), and drop `grid.test.ts` from the `test` script in
      `package.json`.

Edit:

- [ ] `src/lib/lams/nav.ts`: remove the Timetable entries from `STUDENT_NAV`
      and `LECTURER_NAV` (+ `CalendarDays` import); update comments.
- [ ] `src/routes/+layout.svelte`: update the role→nav comment.
- [ ] `src/routes/manage/+page.svelte`: remove the Timetable tab (import,
      `VALID_TABS`, `adminTabs`, panel render) and the "then timetable the
      week" header text; update docblock.
- [ ] `src/routes/admin/+page.svelte`: remove "Build the timetable" button;
      retitle "Students and timetables" card and drop timetable wording from
      header/description.
- [ ] `src/routes/home/+page.svelte`: remove the "My timetable" button (and
      `CalendarDays` import if then unused).
- [ ] `src/lib/components/lams/lecturer-courses-panel.svelte`: drop the
      `api.timetable.listForOffering` query, `meetings` state, "Meets:" line,
      "N slots" badge, `Meeting` import.
- [ ] `src/lib/components/lams/offering-tree.svelte` +
      `my-courses-panel.svelte`: drop "N meeting times" displays; reword
      toasts ("Your timetable builds itself from here.", "Set its timetable
      next.").
- [ ] `src/lib/components/lams/program-board.svelte` +
      `student-courses-dialog.svelte`: drop "N slots"/meeting-count badges.
- [ ] `academic-year-panel.svelte`, `program-picker.svelte`,
      `program-board.svelte` comments; `convex/schema.ts` and
      `convex/academics.ts` comments: drop Timetable mentions.
- [ ] `src/lib/lams/types.ts`: remove timetable-only types (`Meeting`,
      `TimetableWeekly`, `TimetableMakeup`, `TimetableGrid`,
      `TimetableGridCourse`, `TimetableSlot`) once nothing references them.

## Validation

- [ ] `pnpm check` (svelte-check + wrangler types)
- [ ] `pnpm test` (node --test suite, minus grid.test.ts)
- [ ] Grep sweeps: no stray "hall", "50 m", "timetable" UI references left.
