// Toasts, and the one call every component makes when something fails.
//
// `reportError` is the single replacement for the ~70 copies of
// `error = err instanceof Error ? err.message : 'Could not load.'` this project
// grew. Two reasons it is worth having:
//
//   1. The message is unpacked, so a student sees "This lecture is closed."
//      rather than a CONVEX frame. See `errors.ts` for the mapping.
//   2. It has to be called from a `catch`, which means it also has to decide
//      what a toast can even say. So there is exactly one place where that
//      judgement lives.
//
// On the two things this deliberately does NOT do:
//
// It does not retry. A failed mutation may have half-applied on the server, and
// silently re-running it is how duplicate attendance records happen.
//
// It does not swallow. A toast auto-dismisses, so callers that need the failure
// to persist on screen — the full-page student failure, the camera recovery
// prompt — keep their inline markup and call `explainError` directly instead.
// Those are the two places in this app where a transient toast would be the
// wrong tool, and both are about a person being stuck, not about a button that
// did not work.

import { toast } from 'svelte-sonner';
import { errorMessage } from './errors';

/**
 * Show a failure. `fallback` covers a thrown value with no readable message.
 *
 * Errors here are things the person did not ask for and cannot undo by trying
 * again the same way, so the toast stays put rather than auto-dismissing in
 * four seconds.
 */
export function reportError(err: unknown, fallback: string): void {
	toast.error(errorMessage(err, fallback), { duration: 7000 });
}

/**
 * Confirm something worked.
 *
 * `ms` exists because some confirmations are not really confirmations — several
 * are the first half of an instruction ("Class created. Add its students
 * next."). Those are useless if they vanish in four seconds, so callers pass a
 * longer duration for those and leave the default for a plain "Saved."
 */
export function reportSuccess(message: string, ms?: number): void {
	toast.success(message, ms === undefined ? undefined : { duration: ms });
}

/**
 * A failure the person needs to read carefully: their attendance did not get
 * recorded, or their access has gone. Slower to dismiss than `reportError`,
 * because acting on it wrongly costs them the lecture.
 */
export function reportSerious(err: unknown, fallback: string): void {
	toast.error(errorMessage(err, fallback), { duration: Infinity });
}