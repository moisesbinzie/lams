# Memory 0001 — LAMS UI revisions (8 tasks)

Status: DONE
Date: 2026-11-04

## Goal
Implement 8 UI/wording changes in the lams SvelteKit/Convex app and validate.

## Decisions Made
- Task 1 (screen may move): set 15 m by default via the server's DEFAULT_STATION_TOLERANCE_M (already 15) and removed the UI inputs; client no longer sends stationToleranceM (both start-session-form and unused lecture-panel twin updated).
- Task 2: How-to-use page reworded — "To start a lecture / Start here" → "To generate a QR code / Generate QR code" (paragraph, Step 2, FAQ). The in-app "Start lecture" buttons were NOT renamed (scoped to the how-to-use page per the task as written); flag if wanted.
- Task 3: removed the "Lectures" text from the h1 in lectures/+page.svelte; kept the account badges.
- Task 4: "Create lecturer" → "Add lecturer" (button + busy label); overview step label changed too.
- Task 5: default radius 50 → 15 — helpers.ts DEFAULT_STATION_RADIUS_M, attendance.ts fallbacks (startSession ?? 15, quick path const 15), forms radius state, how-it-works 50 metre → 15 metre texts.
- Task 6: removed all below-75% UI from records page (stat card, bulk-change row, amber row tint).
- Task 7: "hall" → "classroom"/"room"/"campus networks" across UI text, comments, and server error strings.
- Task 8: removed timetable UI — deleted routes/timetable, timetable-panel/grid/slot-dialog, grid.ts + grid.test.ts; removed nav entries; removed manage/admin/home/lecturer-courses/offering-tree/my-courses/program-board/student-courses-dialog timetabled UI; updated comments; trimmed timetable-only types in types.ts. Backend (convex/timetable.ts, meetings table) preserved.

## Validation
- pnpm check: 0 errors, 0 warnings.
- pnpm test: 134 passed, 0 failed.
- pnpm build: successful.

## Next Steps
- Open items to flag: rename in-app "Start lecture" buttons to "Generate QR code"? (Task 2 was scoped to the How to use page only.)
- Delete the build output if not wanted in version control.
