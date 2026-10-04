// The stationary station code.
//
// The QR at the front of the hall stays in the same place all lecture, but the
// code inside it does not: a fresh six-digit code every 30 seconds, derived
// from a secret minted when the session opened. A student who scans it with
// their own phone establishes two things at once:
//
//   - they saw this screen as it is right now. A photograph of it is worthless
//     within the minute, so it cannot be sent to an absentee abroad and cashed
//     in later — which is exactly what the old "show your own code to the rep"
//     flow could not stop, because that code stayed valid for the whole window.
//   - their own handset reports where they are, so presence is judged from the
//     student's phone instead of being a proxy from the class rep's.
//
// The second half is what actually stops sharing, and it is worth being precise
// about why. The station code is on a public screen, so anyone standing nearby
// can photograph it and forward it. The photograph is therefore *not* the
// control. What stops it being redeemed from a bedroom is the distance check:
// the redeeming phone reports its own position, and a phone in a bedroom is far
// outside the radius. Two signals, each covering the other's gap.
//
// What this cannot do is survive a deliberately spoofed GPS fix. A determined
// student with a mock-location app, or anyone using a desktop browser with
// developer tools open, can place themselves inside the hall from anywhere. No
// browser-delivered location is a security boundary. Treat the whole scheme as
// a strong deterrent against casual sharing plus a legible audit trail for
// review — never as proof.
//
// The identical algorithm lives in `src/lib/lams/station.ts` for the display
// side; the two must stay in step, so both are covered by tests.

export const STATION_PERIOD_SEC = 30;

/**
 * Slots of drift accepted either side of "now".
 *
 * The clock that matters is the *display's* clock, not the student's: the
 * station derives its code from `Date.now()` on the rep's device and the server
 * does the verifying. A cheap Android handset whose clock drifts by half a
 * minute would otherwise see every scan refused. One slot of slack either way
 * buys that back, at the cost of a photographed code staying usable for up to
 * 90 seconds — short enough to be useless to someone who has to travel.
 */
export const STATION_WINDOW = 1;

/** FNV-1a, then a second mixing round to break slot-to-slot structure. */
function fnv1a(text: string): number {
	let h = 0x811c9dc5;
	for (let i = 0; i < text.length; i += 1) {
		h ^= text.charCodeAt(i);
		h = Math.imul(h, 0x01000193) >>> 0;
	}
	return h >>> 0;
}

/** Numeric code for one time slot. Pure and deterministic. */
export function stationCodeForSlot(secret: string, slot: number): string {
	const a = fnv1a(`${secret}:${slot}`);
	const b = fnv1a(`${a}:${slot}:${secret.length}`);
	const mixed = (a ^ b) >>> 0;
	return (mixed % 1000000).toString().padStart(6, '0');
}

export function stationSlotAt(nowMs: number): number {
	return Math.floor(Math.max(0, nowMs) / 1000 / STATION_PERIOD_SEC);
}

/** The code the station screen should be showing right now. */
export function currentStationCode(secret: string, nowMs = Date.now()): string {
	return stationCodeForSlot(secret, stationSlotAt(nowMs));
}

/** True when the code matches this slot or either neighbour (display clock skew). */
export function verifyStationCode(code: string, secret: string, nowMs = Date.now()): boolean {
	if (!/^\d{6}$/.test(code)) return false;
	const slot = stationSlotAt(nowMs);
	for (let drift = -STATION_WINDOW; drift <= STATION_WINDOW; drift += 1) {
		if (stationCodeForSlot(secret, slot + drift) === code) return true;
	}
	return false;
}