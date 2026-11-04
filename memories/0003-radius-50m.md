# Memory 0003 — Radius 15m → 50m

Status: DONE
Date: 2026-11-04

## Goal
Increase the attendance radius from 15m to 50m across backend defaults, frontend forms, and user guide.

## Decisions Made
- Changed student/station radius defaults, left station *tolerance* at 15m (screen itself should still stay put) and updated its comment to reflect the split.
- Backend: helpers.ts DEFAULT_STATION_RADIUS_M 15→50; attendance.ts startSession fallback ??15→50, quick path const 15→50 + doc comments.
- Frontend: start-session-form radius state '15'→'50', DEFAULT_RADIUS_M 15→50, quick labels/buttons/toast/descriptions/warnings to 50m; lecture-panel radius '15'→'50' + defaults text.
- Guide: how-it-works 4× "15 metre radius" → "50 metre radius".
- Kept: 15-minute lockout messages (time, not distance), illustrative 15m comments, tolerance displays.

## Files Touched
- src/convex/helpers.ts — radius default + tolerance comment
- src/convex/attendance.ts — fallbacks + quick path + docs
- src/lib/components/lams/start-session-form.svelte — state, labels, texts
- src/lib/components/lams/lecture-panel.svelte — state, defaults text
- src/routes/how-it-works/+page.svelte — 4 guide texts

## Notes / Gotchas
- stationToleranceM validation (1..stationRadiusM) still holds: 15 ≤ 50.
- Scan page tolerance/radius displays are dynamic (placement.toleranceM, stationRadiusM) — auto-update, no edit needed.
- Not run here: pnpm check/test/build blocked by sandbox EPERM; run pnpm deploy:dry in a normal terminal before deploying.

## Next Steps
- Run pnpm deploy:dry, then pnpm deploy (or push to trigger Cloudflare build).
