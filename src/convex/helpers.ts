// Shared pure helpers for Convex functions. No Node builtins — Web Crypto only.

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
