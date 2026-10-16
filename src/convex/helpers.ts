// Shared pure helpers for Convex functions. No Node builtins — Web Crypto only.

/**
 * How far from a QR station a student's phone still counts as present when the
 * rep does not say otherwise. Shared with the station backfill migration so a
 * session migrated from the lecture coordinates looks exactly like a fresh one.
 */
export const DEFAULT_STATION_RADIUS_M = 50;

/**
 * How far the station *screen itself* may sit from the room it was pinned to
 * before every scan is refused.
 *
 * Much smaller than `DEFAULT_STATION_RADIUS_M`. The student radius has to hold a
 * whole lecture hall; the screen is one fixed object and is not supposed to
 * travel. At 50 m a station could be carried to a neighbouring building and
 * still pass, which defeats the point of pinning a room to it at all — so the
 * default here is sized for a screen that stays on the front desk.
 */
export const DEFAULT_STATION_TOLERANCE_M = 15;

/**
 * The tolerance to apply to a session.
 *
 * Optional in the schema because sessions predating the station-placement check
 * have no value. Falling back to the student radius is the conservative choice —
 * it is wider, so an un-backfilled session blocks later than a fresh one rather
 * than stranding a whole hall on a stale row.
 */
export function toleranceFor(session: { stationToleranceM?: number; stationRadiusM?: number }): number {
	return session.stationToleranceM ?? session.stationRadiusM ?? DEFAULT_STATION_TOLERANCE_M;
}

export function normalizeReg(value: string): string {
	return value.trim().toUpperCase().replace(/\s+/g, ' ');
}

export function normalizeId(value: string): string {
	return value.trim().toUpperCase().replace(/\s+/g, '');
}

export function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
	const R = 6371000;
	const toRad = (d: number) => (d * Math.PI) / 180;
	const dLat = toRad(lat2 - lat1);
	const dLng = toRad(lng2 - lng1);
	const a =
		Math.sin(dLat / 2) * Math.sin(dLat / 2) +
		Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
	return 2 * R * Math.asin(Math.sqrt(a));
}

export function randomHex(bytes: number): string {
	const buf = new Uint8Array(bytes);
	crypto.getRandomValues(buf);
	return Array.from(buf)
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('');
}

export async function sha256Hex(text: string): Promise<string> {
	const data = new TextEncoder().encode(text);
	const digest = await crypto.subtle.digest('SHA-256', data);
	return Array.from(new Uint8Array(digest))
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('');
}

export type AutoStatus = 'Present' | 'Late' | 'Out_of_Range' | 'Absent';

/**
 * How far a new station pin may sit from where an offering usually meets
 * before the start is refused as a probable wrong-room pin. A single-shot GPS
 * fix on a phone that just woke its radio is often a stale fix from wherever
 * the phone last had signal — kilometres away with a plausible accuracy — and
 * nothing else catches it, because the display device then agrees with the pin
 * it was started from. History is the only witness: a course meets in the same
 * room week after week, so a pin half a kilometre from every previous one is
 * almost certainly not the hall.
 */
export const FAR_PIN_WARN_M = 500;

/**
 * Above this student distance the pin itself is the likelier fault than the
 * student's phone: nobody's handset is a kilometre wrong while claiming ±80 m.
 * The result page says so instead of implying the student was not there.
 */
export const STATION_WRONG_SUSPECT_M = 1000;

/**
 * Whether the newest-first statuses of the last `required` closed lectures
 * form an unbroken no-show streak that withdraws a student from a course.
 *
 * Only `Absent` (including a missing row after close) and `Out_of_Range`
 * continue the streak — the student was not confirmed present. `Present`,
 * `Late` and `Excused` break it: time off that was agreed never counts
 * against the student. Anything unrecognised breaks the streak rather than
 * withdrawing someone on ambiguous data.
 */
export function isNoShowStreak(
	statusesNewestFirst: (string | null | undefined)[],
	required: number
): boolean {
	if (required < 1 || statusesNewestFirst.length < required) return false;
	for (let i = 0; i < required; i++) {
		const st = statusesNewestFirst[i] ?? 'Absent';
		if (st !== 'Absent' && st !== 'Out_of_Range') return false;
	}
	return true;
}

/**
 * Refuses a station pin taken from a GPS fix coarser than the radius it has to
 * prove. A pin captured at ±300 m for a 50 m room can sit streets away from the
 * hall, and every honest scan then reads as hundreds of metres Out_of_Range —
 * the failure mode that only "widen the radius to 1000 m" papers over.
 *
 * Returns the refusal message, or null when the pin may be used. A pin with no
 * reported accuracy (typed by hand) is the caller's responsibility and passes.
 */
export function pinAccuracyError(
	accuracyM: number | undefined,
	radiusM: number
): string | null {
	if (accuracyM === undefined) return null;
	if (accuracyM <= radiusM) return null;
	return (
		`This location is only accurate to ±${Math.round(accuracyM)} m, which is coarser ` +
		`than the ${radiusM} m allowed distance. Wait for a better fix, move near a ` +
		`window or doorway, or widen the allowed distance first — otherwise every ` +
		`student will scan as out of range.`
	);
}

/**
 * Whether a scan may be recorded for a person, given which phone it came from.
 *
 * Split out from the guard in `auth.ts` so the decision itself is testable
 * without a Convex context, and so the rule can be read in one place.
 *
 * Three ways to fail, and they need different messages because the student has
 * to know whether to sign in again or to go and find their new phone:
 *
 *   unknown-session — no live session for this token at all
 *   mismatch        — the token was moved onto a different handset
 *   moved           — the account is now bound to a different handset
 */
export type DeviceVerdict =
	| { ok: true }
	| { ok: false; reason: 'unknown-session' | 'mismatch' | 'moved' };

export function judgeScanDevice(
	/** Device the token was issued to, read from the session row. */
	issuedTo: string | null,
	/** Device this request claims to be coming from. */
	presented: string,
	/** Device the account is bound to, if it has ever signed in. */
	boundTo?: string
): DeviceVerdict {
	if (!presented) return { ok: false, reason: 'unknown-session' };
	if (issuedTo === null) return { ok: false, reason: 'unknown-session' };
	if (issuedTo !== presented) return { ok: false, reason: 'mismatch' };
	if (boundTo && boundTo !== presented) return { ok: false, reason: 'moved' };
	return { ok: true };
}

/**
 * Turns elapsed time plus distance into a status.
 *
 * Three time tiers, both thresholds adjustable by the lecturer:
 *   within `onTimeSec`   -> Present
 *   within `lateUntilSec`-> Late
 *   after that           -> Absent
 *
 * Distance overrides the time tier: someone outside the permitted radius is
 * flagged `Out_of_Range` however early they arrived, because that is the
 * condition a lecturer needs to look into rather than simply accept.
 */
export function computeAutoStatus(
	elapsedSec: number,
	onTimeSec: number,
	lateUntilSec: number,
	distanceM: number | null,
	radiusM: number
): AutoStatus {
	if (distanceM !== null && distanceM > radiusM) return 'Out_of_Range';
	if (elapsedSec <= onTimeSec) return 'Present';
	if (elapsedSec <= lateUntilSec) return 'Late';
	return 'Absent';
}
