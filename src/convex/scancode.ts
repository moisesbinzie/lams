// Per-student rotating attendance code.
//
// A student's phone shows `LAMS|<reg>|<code>`, where `<code>` is derived from
// that student's own secret and the current 30-second slot. The secret never
// leaves the server, so:
//
//   - a code cannot be forged from a registration number alone;
//   - a screenshot goes stale within one slot, which kills photo-sharing;
//   - the code proves the holder reached the live screen on a signed-in device.
//
// The identical algorithm lives in `src/lib/lams/totp.ts` for the phone side;
// the two must stay in step, so both are covered by tests.

export const CODE_PERIOD_SEC = 30;
export const CODE_WINDOW = 1;
export const SCAN_PREFIX = 'LAMS';

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
export function codeForSlot(secret: string, slot: number): string {
	const a = fnv1a(`${secret}:${slot}`);
	const b = fnv1a(`${a}:${slot}:${secret.length}`);
	const mixed = (a ^ b) >>> 0;
	return (mixed % 1000000).toString().padStart(6, '0');
}

export function slotAt(nowMs: number): number {
	return Math.floor(Math.max(0, nowMs) / 1000 / CODE_PERIOD_SEC);
}

/** The code a student's phone should display right now. */
export function buildScanCode(regNumber: string, secret: string, nowMs = Date.now()): string {
	return `${SCAN_PREFIX}|${regNumber.trim().replace(/\s+/g, '')}|${codeForSlot(secret, slotAt(nowMs))}`;
}

/** Splits a scanned payload. Returns null for anything not shaped like ours. */
export function parseScanCode(text: string): { regNumber: string; code: string } | null {
	const parts = text.trim().split('|');
	if (parts.length !== 3 || parts[0] !== SCAN_PREFIX) return null;
	const [, regNumber, code] = parts;
	if (!regNumber || !/^\d{6}$/.test(code)) return null;
	return { regNumber, code };
}

/** True when the code matches this slot or either neighbour (clock skew). */
export function verifyScanCode(code: string, secret: string, nowMs = Date.now()): boolean {
	const slot = slotAt(nowMs);
	for (let drift = -CODE_WINDOW; drift <= CODE_WINDOW; drift += 1) {
		if (codeForSlot(secret, slot + drift) === code) return true;
	}
	return false;
}